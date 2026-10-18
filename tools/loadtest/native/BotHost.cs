// BotHost: a headless multiplexer for MpClientPlugin.dll, the same native client plugin the game uses.
// One process hosts several bots. The DLL keeps its client in a file-static, so each bot loads its own
// copy of the file under a different name; Windows then gives each copy its own module and its own state.
// Line protocol on stdin/stdout, driven by ..\lib\host.js. C# 5 only: this is built with the csc.exe that
// ships with Windows (.NET Framework), so no interpolated strings and no newer syntax.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class Native
{
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
    internal static extern IntPtr LoadLibrary(string path);

    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
    internal static extern IntPtr GetProcAddress(IntPtr module, string name);

    // Signatures from fork\skymp5-server\cpp\client\main.cpp (extern "C" exports)
    internal delegate void CreateClientFn(byte[] hostName, ushort port);
    internal delegate void DestroyClientFn();
    [return: MarshalAs(UnmanagedType.I1)]
    internal delegate bool IsConnectedFn();
    internal delegate void SendFn(byte[] jsonContent, [MarshalAs(UnmanagedType.I1)] bool reliable);
    internal delegate void TickFn(OnPacketFn onPacket, IntPtr state);
    // void (*)(int32_t type, const char* rawContent, size_t length, const char* error, void* state)
    internal delegate void OnPacketFn(int type, IntPtr rawContent, IntPtr length, IntPtr error, IntPtr state);
}

internal class Bot
{
    public int Id;
    public Native.CreateClientFn CreateClient;
    public Native.DestroyClientFn DestroyClient;
    public Native.IsConnectedFn IsConnected;
    public Native.SendFn Send;
    public Native.TickFn Tick;

    public bool Connected;
    public long Rx;             // messages received
    public long RxBytes;        // deserialized JSON bytes received (see README: a proxy, not wire bytes)
    public long Tx;             // messages sent
    public long TxBytes;        // JSON bytes handed to the serializer
    public Dictionary<int, long> RxByType = new Dictionary<int, long>();

    // Per-emitter movement counting, for checking an interest-management ladder (see README, Interest check).
    // SelfIdx is told to us by the runner; PosX/PosY are this bot's own last sent position, so the distance
    // to each emitter is measured from where the bot actually is rather than from where it was placed.
    public int SelfIdx = -1;
    public double PosX, PosY;
    public bool HasPos;
    public long SelfEcho;
    public Dictionary<int, Emitter> Movers = new Dictionary<int, Emitter>();
}

internal class Emitter
{
    public long Count;      // UpdateMovement messages received about this emitter
    public double Dist;     // XY distance at the last one, in game units
}

internal static class Program
{
    private static readonly Dictionary<int, Bot> Bots = new Dictionary<int, Bot>();
    private static readonly ConcurrentQueue<string> Commands = new ConcurrentQueue<string>();
    private static readonly HashSet<int> Forward = new HashSet<int>();
    private static readonly StringBuilder Out = new StringBuilder();
    private static Native.OnPacketFn _onPacket; // kept alive: the DLL holds this pointer during Tick
    private static StreamWriter _stdout;
    private static string _dllPath;
    private static string _workDir;
    private static int _hostId;
    private static bool _quit;
    private static double _fullUnits, _midUnits;

    private static int Main(string[] args)
    {
        _dllPath = null;
        _workDir = Path.GetTempPath();
        _hostId = 0;
        var tickMs = 1;
        var statsMs = 1000;
        // The ladder being checked: full rate inside this, mid rate out to one grid square, far beyond
        _fullUnits = 2000;
        _midUnits = 4096;

        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--dll") _dllPath = args[i + 1];
            else if (args[i] == "--work") _workDir = args[i + 1];
            else if (args[i] == "--id") _hostId = int.Parse(args[i + 1], CultureInfo.InvariantCulture);
            else if (args[i] == "--tick-ms") tickMs = int.Parse(args[i + 1], CultureInfo.InvariantCulture);
            else if (args[i] == "--stats-ms") statsMs = int.Parse(args[i + 1], CultureInfo.InvariantCulture);
            else if (args[i] == "--full-units") _fullUnits = double.Parse(args[i + 1], CultureInfo.InvariantCulture);
            else if (args[i] == "--mid-units") _midUnits = double.Parse(args[i + 1], CultureInfo.InvariantCulture);
            else if (args[i] == "--forward")
            {
                foreach (var part in args[i + 1].Split(','))
                {
                    int t;
                    if (int.TryParse(part.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out t)) Forward.Add(t);
                }
            }
        }

        if (_dllPath == null || !File.Exists(_dllPath))
        {
            Console.Error.WriteLine("BotHost: --dll <MpClientPlugin.dll> is required");
            return 2;
        }
        Directory.CreateDirectory(_workDir);

        _stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false), 1 << 16);
        _stdout.AutoFlush = false;
        _onPacket = OnPacket;

        var reader = new Thread(ReadStdin);
        reader.IsBackground = true;
        reader.Start();

        Emit("ready " + _hostId);
        Flush();

        var lastStats = Environment.TickCount;
        while (!_quit)
        {
            string line;
            while (Commands.TryDequeue(out line)) Handle(line);

            foreach (var bot in Bots.Values)
            {
                try { bot.Tick(_onPacket, new IntPtr(bot.Id)); }
                catch (Exception e) { Emit("log tick failed for " + bot.Id + ": " + e.Message); }
            }

            if (Environment.TickCount - lastStats >= statsMs)
            {
                lastStats = Environment.TickCount;
                EmitStats();
            }

            Flush();
            Thread.Sleep(tickMs);
        }

        foreach (var bot in Bots.Values)
        {
            try { bot.DestroyClient(); } catch { }
        }
        Flush();
        return 0;
    }

    private static void ReadStdin()
    {
        var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        while (true)
        {
            var line = input.ReadLine();
            if (line == null) { Commands.Enqueue("quit"); return; }
            if (line.Length > 0) Commands.Enqueue(line);
        }
    }

    private static void Handle(string line)
    {
        try
        {
            var sp = line.IndexOf(' ');
            var verb = sp < 0 ? line : line.Substring(0, sp);
            var rest = sp < 0 ? "" : line.Substring(sp + 1);

            switch (verb)
            {
                case "new": CmdNew(int.Parse(rest.Trim(), CultureInfo.InvariantCulture)); break;
                case "connect": CmdConnect(rest); break;
                case "send": CmdSend(rest); break;
                case "close": CmdClose(int.Parse(rest.Trim(), CultureInfo.InvariantCulture)); break;
                case "self": CmdSelf(rest); break;
                case "stats": EmitStats(); break;
                case "quit": _quit = true; break;
                default: Emit("log unknown command " + verb); break;
            }
        }
        catch (Exception e)
        {
            Emit("log command failed: " + e.Message);
        }
    }

    private static void CmdNew(int id)
    {
        if (Bots.ContainsKey(id)) { Emit("ok new " + id); return; }

        // A private copy of the DLL per bot: the exported client lives in a file-static
        var copy = Path.Combine(_workDir, "mpclient_" + _hostId + "_" + id + ".dll");
        if (!File.Exists(copy)) File.Copy(_dllPath, copy, false);

        var module = Native.LoadLibrary(copy);
        if (module == IntPtr.Zero)
        {
            Emit("err new " + id + " LoadLibrary failed " + Marshal.GetLastWin32Error());
            return;
        }

        var bot = new Bot();
        bot.Id = id;
        bot.CreateClient = (Native.CreateClientFn)Resolve(module, "CreateClient", typeof(Native.CreateClientFn));
        bot.DestroyClient = (Native.DestroyClientFn)Resolve(module, "DestroyClient", typeof(Native.DestroyClientFn));
        bot.IsConnected = (Native.IsConnectedFn)Resolve(module, "IsConnected", typeof(Native.IsConnectedFn));
        bot.Send = (Native.SendFn)Resolve(module, "Send", typeof(Native.SendFn));
        bot.Tick = (Native.TickFn)Resolve(module, "Tick", typeof(Native.TickFn));
        Bots[id] = bot;
        Emit("ok new " + id);
    }

    private static Delegate Resolve(IntPtr module, string name, Type type)
    {
        var addr = Native.GetProcAddress(module, name);
        if (addr == IntPtr.Zero) throw new Exception("export " + name + " not found");
        return Marshal.GetDelegateForFunctionPointer(addr, type);
    }

    private static void CmdConnect(string rest)
    {
        var parts = rest.Split(' ');
        var id = int.Parse(parts[0], CultureInfo.InvariantCulture);
        var host = parts[1];
        var port = ushort.Parse(parts[2], CultureInfo.InvariantCulture);
        Bot bot;
        if (!Bots.TryGetValue(id, out bot)) { Emit("err connect " + id + " no such bot"); return; }
        bot.CreateClient(Cstr(host), port);
        Emit("ok connect " + id);
    }

    private static void CmdSend(string rest)
    {
        var a = rest.IndexOf(' ');
        var b = rest.IndexOf(' ', a + 1);
        var id = int.Parse(rest.Substring(0, a), CultureInfo.InvariantCulture);
        var reliable = rest[a + 1] == '1';
        var json = rest.Substring(b + 1);
        Bot bot;
        if (!Bots.TryGetValue(id, out bot)) return;
        var bytes = Cstr(json);
        // Remember where this bot says it is, so inbound movement can be measured against it. Only its own
        // movement counts: with --host-npcs a bot also sends movement for actors it hosts.
        if (bot.SelfIdx >= 0 && json.IndexOf("\"t\":2", StringComparison.Ordinal) >= 0 &&
            json.IndexOf("\"idx\":" + bot.SelfIdx.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal) >= 0)
        {
            var at = json.IndexOf("\"pos\":[", StringComparison.Ordinal);
            if (at >= 0)
            {
                var parts = json.Substring(at + 7).Split(new[] { ',', ']' });
                double px, py;
                if (parts.Length >= 2 &&
                    double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out px) &&
                    double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out py))
                {
                    bot.PosX = px; bot.PosY = py; bot.HasPos = true;
                }
            }
        }
        bot.Send(bytes, reliable);
        bot.Tx++;
        bot.TxBytes += bytes.Length - 1;
    }

    // "self <botId> <idx>": the bot's own form index, so its echo is counted apart and its own sent
    // position can be read from the movement it sends
    private static void CmdSelf(string rest)
    {
        var sp = rest.IndexOf(' ');
        if (sp < 0) return;
        var id = int.Parse(rest.Substring(0, sp), CultureInfo.InvariantCulture);
        Bot bot;
        if (!Bots.TryGetValue(id, out bot)) return;
        bot.SelfIdx = int.Parse(rest.Substring(sp + 1).Trim(), CultureInfo.InvariantCulture);
    }

    private static void CmdClose(int id)
    {
        Bot bot;
        if (!Bots.TryGetValue(id, out bot)) return;
        try { bot.DestroyClient(); } catch { }
        bot.Connected = false;
        Emit("ev " + id + " closed");
    }

    private static byte[] Cstr(string s)
    {
        var raw = Encoding.UTF8.GetBytes(s);
        var buf = new byte[raw.Length + 1];
        Array.Copy(raw, buf, raw.Length);
        return buf;
    }

    // Called by the DLL inside Tick. Keep it cheap: buffer output, no allocation for messages we drop.
    private static void OnPacket(int type, IntPtr rawContent, IntPtr length, IntPtr error, IntPtr state)
    {
        var id = state.ToInt32();
        Bot bot;
        if (!Bots.TryGetValue(id, out bot)) return;

        // Networking::PacketType (NetworkingInterface.h): 0 message, 1 disconnect, 2 accepted, 3 failed, 4 denied
        if (type != 0)
        {
            var name = type == 1 ? "disconnect"
                : type == 2 ? "connectionAccepted"
                : type == 3 ? "connectionFailed"
                : type == 4 ? "connectionDenied"
                : "packetType" + type;
            if (type == 2) bot.Connected = true;
            if (type == 1 || type == 3 || type == 4) bot.Connected = false;
            var err = error == IntPtr.Zero ? "" : Marshal.PtrToStringAnsi(error);
            Emit("ev " + id + " " + name + (string.IsNullOrEmpty(err) ? "" : " " + err));
            return;
        }

        var len = length.ToInt64();
        bot.Rx++;
        bot.RxBytes += len;
        var msgType = PeekMsgType(rawContent, len);
        long n;
        bot.RxByType.TryGetValue(msgType, out n);
        bot.RxByType[msgType] = n + 1;

        // Movement is the only type worth counting per emitter, and it is the one the ladder throttles.
        // Done here rather than in the runner because UpdateMovement is normally not forwarded at all: at
        // 620 a second per bot the line protocol would cost more than the measurement is worth.
        if (msgType == 2) CountMover(bot, rawContent, len);

        if (!Forward.Contains(msgType)) return;

        var buf = new byte[len];
        Marshal.Copy(rawContent, buf, 0, (int)len);
        Emit("msg " + id + " " + Encoding.UTF8.GetString(buf));
    }

    // Reads the "t" field out of the JSON dump without decoding the whole message.
    // nlohmann dumps object keys in alphabetical order, so "t" sits at or near the END of every message
    // ("data","idx","t" for movement): scanning backwards finds it in a handful of bytes. A match whose
    // quote is preceded by a backslash is an escaped key inside a nested dump (contentJsonDump) and is skipped.
    private static int PeekMsgType(IntPtr p, long len)
    {
        var n = (int)Math.Min(len, int.MaxValue);
        for (var i = n - 5; i >= 0; i--)
        {
            if (Marshal.ReadByte(p, i) != (byte)'"') continue;
            if (Marshal.ReadByte(p, i + 1) != (byte)'t') continue;
            if (Marshal.ReadByte(p, i + 2) != (byte)'"') continue;
            if (Marshal.ReadByte(p, i + 3) != (byte)':') continue;
            if (i > 0)
            {
                var before = Marshal.ReadByte(p, i - 1);
                if (before != (byte)',' && before != (byte)'{') continue;
            }
            var j = i + 4;
            var value = 0;
            var digits = 0;
            while (j < n)
            {
                var c = Marshal.ReadByte(p, j);
                if (c < (byte)'0' || c > (byte)'9') break;
                value = value * 10 + (c - (byte)'0');
                digits++;
                j++;
            }
            if (digits > 0) return value;
        }
        return -1;
    }

    private static void CountMover(Bot bot, IntPtr p, long len)
    {
        var idx = ReadIntField(p, len, "idx");
        if (idx < 0) return;
        if (idx == bot.SelfIdx) { bot.SelfEcho++; return; }

        Emitter e;
        if (!bot.Movers.TryGetValue(idx, out e)) { e = new Emitter(); bot.Movers[idx] = e; }
        e.Count++;

        // XY only: the server streams by an X/Y grid, so XY is the distance the ladder would use
        double x, y;
        if (bot.HasPos && ReadPosXY(p, len, out x, out y))
        {
            var dx = x - bot.PosX;
            var dy = y - bot.PosY;
            e.Dist = Math.Sqrt(dx * dx + dy * dy);
        }
    }

    // Finds "name" and returns the index just past its closing quote, or -1
    private static int FindKey(IntPtr p, long len, string name)
    {
        var n = (int)Math.Min(len, int.MaxValue);
        for (var i = 0; i + name.Length + 2 <= n; i++)
        {
            if (Marshal.ReadByte(p, i) != (byte)'"') continue;
            var hit = true;
            for (var j = 0; j < name.Length; j++)
            {
                if (Marshal.ReadByte(p, i + 1 + j) != (byte)name[j]) { hit = false; break; }
            }
            if (!hit) continue;
            if (Marshal.ReadByte(p, i + 1 + name.Length) != (byte)'"') continue;
            return i + 2 + name.Length;
        }
        return -1;
    }

    private static int ReadIntField(IntPtr p, long len, string name)
    {
        var i = FindKey(p, len, name);
        if (i < 0) return -1;
        while (i < len)
        {
            var c = Marshal.ReadByte(p, i);
            if (c == (byte)':' || c == (byte)' ') { i++; continue; }
            break;
        }
        long v = 0;
        var any = false;
        while (i < len)
        {
            var c = Marshal.ReadByte(p, i);
            if (c < (byte)'0' || c > (byte)'9') break;
            v = v * 10 + (c - (byte)'0');
            any = true;
            i++;
        }
        return any ? (int)v : -1;
    }

    // "pos":[x,y,z] -> x and y. nlohmann writes plain decimals, and an exponent is handled by TryParse
    private static bool ReadPosXY(IntPtr p, long len, out double x, out double y)
    {
        x = 0; y = 0;
        var i = FindKey(p, len, "pos");
        if (i < 0) return false;
        while (i < len && Marshal.ReadByte(p, i) != (byte)'[') i++;
        i++;
        return ReadDouble(p, len, ref i, out x) && ReadDouble(p, len, ref i, out y);
    }

    private static bool ReadDouble(IntPtr p, long len, ref int i, out double value)
    {
        value = 0;
        var sb = new StringBuilder(32);
        while (i < len)
        {
            var c = (char)Marshal.ReadByte(p, i);
            if (c == ',' || c == ']') { i++; break; }
            if (sb.Length < 32) sb.Append(c);
            i++;
        }
        return double.TryParse(sb.ToString().Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out value);
    }

    private static void EmitStats()
    {
        foreach (var bot in Bots.Values)
        {
            var sb = new StringBuilder();
            sb.Append("stat ").Append(bot.Id).Append(" {\"connected\":").Append(bot.Connected ? "true" : "false");
            sb.Append(",\"rx\":").Append(bot.Rx).Append(",\"rxBytes\":").Append(bot.RxBytes);
            sb.Append(",\"tx\":").Append(bot.Tx).Append(",\"txBytes\":").Append(bot.TxBytes);
            sb.Append(",\"rxByType\":{");
            var first = true;
            foreach (var kv in bot.RxByType)
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append('"').Append(kv.Key).Append("\":").Append(kv.Value);
            }
            sb.Append("}");

            // The interest check: emitters and messages by distance band, plus the busiest emitters so a
            // ladder can be judged per actor and not only by its total
            long fullE = 0, fullM = 0, midE = 0, midM = 0, farE = 0, farM = 0, unknownE = 0, unknownM = 0;
            foreach (var kv in bot.Movers)
            {
                var d = kv.Value.Dist;
                var c = kv.Value.Count;
                if (d <= 0) { unknownE++; unknownM += c; }
                else if (d <= _fullUnits) { fullE++; fullM += c; }
                else if (d <= _midUnits) { midE++; midM += c; }
                else { farE++; farM += c; }
            }
            sb.Append(",\"selfEcho\":").Append(bot.SelfEcho);
            sb.Append(",\"movers\":").Append(bot.Movers.Count);
            sb.Append(",\"tiers\":{\"full\":{\"e\":").Append(fullE).Append(",\"m\":").Append(fullM).Append("}");
            sb.Append(",\"mid\":{\"e\":").Append(midE).Append(",\"m\":").Append(midM).Append("}");
            sb.Append(",\"far\":{\"e\":").Append(farE).Append(",\"m\":").Append(farM).Append("}");
            sb.Append(",\"unknown\":{\"e\":").Append(unknownE).Append(",\"m\":").Append(unknownM).Append("}}");

            var top = new List<KeyValuePair<int, Emitter>>(bot.Movers);
            top.Sort((a, b) => b.Value.Count.CompareTo(a.Value.Count));
            sb.Append(",\"top\":\"");
            for (var i = 0; i < top.Count && i < 40; i++)
            {
                if (i > 0) sb.Append(",");
                sb.Append(top[i].Key).Append(":").Append(top[i].Value.Count).Append(":")
                  .Append(((long)top[i].Value.Dist).ToString(CultureInfo.InvariantCulture));
            }
            sb.Append("\"}");
            Emit(sb.ToString());
        }
    }

    private static void Emit(string line)
    {
        Out.Append(line).Append('\n');
        if (Out.Length > 1 << 18) Flush();
    }

    private static void Flush()
    {
        if (Out.Length == 0) return;
        _stdout.Write(Out.ToString());
        Out.Length = 0;
        _stdout.Flush();
    }
}
