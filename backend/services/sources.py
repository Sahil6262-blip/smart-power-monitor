import math
import random
import time
from typing import Protocol

from database import utcnow
from schemas import ReadingIn


class DataSource(Protocol):
    name: str

    def sample(self) -> ReadingIn | None: ...


class Simulator:
    name = "demo"

    def __init__(self, energy=0):
        self.energy = energy
        self.last_tick = time.monotonic()
        self.phase = random.random() * math.tau

    def sample(self):
        now = utcnow()
        tick = time.monotonic()
        elapsed = tick - self.last_tick
        self.last_tick = tick
        t = now.timestamp()
        voltage = 230 + 2.5 * math.sin(t / 19) + random.uniform(-0.5, 0.5)
        current = (
            2.35
            + 0.65 * math.sin(t / 27 + self.phase)
            + 0.28 * math.sin(t / 5)
            + random.uniform(-0.045, 0.045)
        )
        pf = 0.93 + 0.035 * math.sin(t / 47)
        power = voltage * current * pf
        self.energy += power * elapsed / 3_600_000
        return ReadingIn(
            timestamp=now,
            voltage=round(voltage, 2),
            current=round(current, 3),
            power=round(power, 2),
            energy=round(self.energy, 8),
            frequency=round(50 + 0.08 * math.sin(t / 11), 2),
            power_factor=round(pf, 3),
        )


class HardwareSource:
    """Push adapter: POST /api/readings feeds the same validated ingest pipeline.

    MQTT/serial adapters can call Runtime.ingest(ReadingIn) without UI changes.
    """

    name = "hardware"

    def sample(self):
        return None
