import { logError } from "../logging";

export class IdManager {
  allocateIdFor(value: number): number {
    // Re-allocating a server idx that is still mapped orphans the old slot: the previous local id
    // keeps pointing at a form nobody can reach, and a later destroy for that idx resolves to the
    // WRONG slot. If a player is ever ejected to the main menu by a destroy that was not about
    // them, this is where it would begin, so it is loud rather than silent.
    const existing = this.idByValue[value];
    if (typeof existing === "number") {
      logError("IdManager", `allocateIdFor: server idx ${value} is already mapped to local id ${existing}; orphaning it and remapping`);
    }

    if (this.idByValue.length <= value) {
      this.idByValue.length = value + 1;
    }
    this.idByValue[value] = this.minimumUnusedId;

    if (this.valueById.length <= this.minimumUnusedId) {
      this.valueById.length = this.minimumUnusedId + 1;
    }
    this.valueById[this.minimumUnusedId] = value;

    const res = this.minimumUnusedId;
    this.minimumUnusedId++;
    while (
      this.valueById.length > this.minimumUnusedId &&
      typeof this.valueById[this.minimumUnusedId] === "number"
    ) {
      this.minimumUnusedId++;
    }
    return res;
  }

  freeIdFor(value: number): void {
    const id = this.idByValue[value];
    // Freeing an idx that was never mapped used to run on with id === undefined, which assigned
    // valueById[undefined] and left a bogus "undefined" key on the array.
    if (typeof id !== "number") {
      logError("IdManager", `freeIdFor: server idx ${value} is not mapped, ignoring`);
      return;
    }
    if (id < this.minimumUnusedId) {
      this.minimumUnusedId = id;
    }
    this.idByValue[value] = undefined;
    this.valueById[id] = undefined;
    return;
  }

  getId(value: number): number {
    const r = this.idByValue[value];
    return typeof r === "number" ? r : -1;
  }

  getValueById(id: number): number | undefined {
    return this.valueById[id];
  }

  private idByValue = new Array<number | undefined>();
  private valueById = new Array<number | undefined>();
  private minimumUnusedId = 0;
}
