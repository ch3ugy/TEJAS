// WebSocket real-time telemetry listener

class WebSocketService {
  constructor() {
    this.ws = null;
    this.subscribers = new Set();
    this.reconnectTimeout = null;
  }

  connect() {
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws/events';
    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("Connected to TEJAS real-time surveillance WebSocket stream");
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.subscribers.forEach(cb => cb(data));
        } catch (e) {
          console.error("Failed to parse incoming WebSocket message:", e);
        }
      };

      this.ws.onclose = () => {
        this.reconnectTimeout = setTimeout(() => this.connect(), 5000);
      };

      this.ws.onerror = () => {
        if (this.ws) this.ws.close();
      };
    } catch (e) {
      console.warn("WebSocket connection deferred, running in simulated mode");
    }
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
}

export const wsService = new WebSocketService();
