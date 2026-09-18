import asyncio
import logging
from typing import List, Optional
from fastapi import WebSocket

logger = logging.getLogger("tejas.websocket")

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket client connected. Total active: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket client disconnected. Total active: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.debug(f"Failed to send to client: {e}")
                self.disconnect(connection)

    def broadcast_sync(self, message: dict):
        """Thread-safe synchronous broadcast callable from background threads."""
        if not self.active_connections:
            return
        if self.loop is not None and self.loop.is_running():
            try:
                asyncio.run_coroutine_threadsafe(self.broadcast(message), self.loop)
            except Exception as e:
                logger.warning(f"Error scheduling broadcast: {e}")

manager = ConnectionManager()

