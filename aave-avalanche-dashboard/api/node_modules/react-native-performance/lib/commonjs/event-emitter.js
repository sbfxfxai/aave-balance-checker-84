"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createEventEmitter = void 0;
const createEventEmitter = () => {
  const callbacks = new Set();
  const addEventListener = callback => {
    callbacks.add(callback);
  };
  const removeEventListener = callback => {
    callbacks.delete(callback);
  };
  const emit = event => {
    callbacks.forEach(callback => {
      callback(event);
    });
  };
  return {
    addEventListener,
    removeEventListener,
    emit
  };
};
exports.createEventEmitter = createEventEmitter;
//# sourceMappingURL=event-emitter.js.map