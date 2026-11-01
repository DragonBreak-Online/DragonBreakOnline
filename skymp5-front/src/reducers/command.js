const defaultState = {};

export const commandReducer = (state = defaultState, action) => {
  switch (action.type) {
    case "COMMAND": {
      switch (action.data.commandType) {
        default:
          setTimeout(() => {
            if (!Array.isArray(action.data.alter)) {
              action.data.alter = [action.data.alter];
            }
            for (const msg of action.data.alter) {
              window.storage.dispatch({
                type: "ADD_CHAT_MSG",
                data: msg,
              });
            }
          }, 1);
      }
      return {
        ...state,
      };
    }
  }

  return state;
};
