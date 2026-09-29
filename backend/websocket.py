import asyncio

from fastapi import WebSocket


class ConnectionManager:
    """A bounded queue per client keeps slow browsers off the ingestion path."""

    def __init__(self):
        self.clients: dict[WebSocket, asyncio.Queue] = {}

    async def connect(self, socket):
        await socket.accept()
        queue = asyncio.Queue(maxsize=3)
        self.clients[socket] = queue
        return queue

    def disconnect(self, socket):
        self.clients.pop(socket, None)

    def broadcast(self, message):
        for queue in tuple(self.clients.values()):
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(message)

    async def close(self):
        for socket in tuple(self.clients):
            try:
                await socket.close(code=1001)
            except Exception:
                pass
        self.clients.clear()


manager = ConnectionManager()
