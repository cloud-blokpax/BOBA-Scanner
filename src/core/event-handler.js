// Centralized Event Handler Registry
class EventHandlerRegistry {
    constructor() {
        this.handlers = {};
    }

    register(event, handler) {
        if (!this.handlers[event]) {
            this.handlers[event] = [];
        }
        this.handlers[event].push(handler);
    }

    unregister(event, handler) {
        if (!this.handlers[event]) return;
        this.handlers[event] = this.handlers[event].filter(h => h !== handler);
    }

    emit(event, ...args) {
        if (!this.handlers[event]) return;
        this.handlers[event].forEach(handler => handler(...args));
    }
}

// Exporting the registry instance
const registry = new EventHandlerRegistry();
export default registry;