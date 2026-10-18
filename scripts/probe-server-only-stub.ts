/**
 * Must be imported before any app modules that transitively load `server-only`.
 * Used by local tsx probe scripts only.
 */
import Module from "node:module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};
