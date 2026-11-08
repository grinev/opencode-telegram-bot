import dgram from "node:dgram";
import os from "node:os";
import net from "node:net";
import type { GatewayConfig } from "./types.js";

export function createMagicPacket(macAddress: string): Buffer {
  const bytes = macAddress.replace(/[:-]/g, "").match(/.{2}/g);
  if (!bytes || bytes.length !== 6 || bytes.some((byte) => !/^[0-9a-f]{2}$/i.test(byte))) {
    throw new Error("Invalid MAC address");
  }

  const mac = Buffer.from(bytes.map((byte) => Number.parseInt(byte, 16)));
  const packet = Buffer.alloc(6 + 16 * mac.length, 0xff);
  for (let offset = 6; offset < packet.length; offset += mac.length) {
    mac.copy(packet, offset);
  }
  return packet;
}

export function resolveInterfaceAddress(interfaceNameOrAddress: string): string {
  if (net.isIP(interfaceNameOrAddress) === 4) {
    return interfaceNameOrAddress;
  }

  const addresses = os.networkInterfaces()[interfaceNameOrAddress];
  const address = addresses?.find((entry) => entry.family === "IPv4");
  if (!address) {
    throw new Error(`WOL_INTERFACE does not resolve to an IPv4 address: ${interfaceNameOrAddress}`);
  }
  return address.address;
}

export function sendWakeOnLan(config: GatewayConfig): Promise<void> {
  const packet = createMagicPacket(config.wolMacAddress);
  const socket = dgram.createSocket("udp4");
  const sourceAddress = config.wolInterface
    ? resolveInterfaceAddress(config.wolInterface)
    : undefined;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.close();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    socket.once("error", (error) => finish(error));
    const send = (): void => {
      socket.setBroadcast(true);
      socket.send(packet, 9, config.wolBroadcastAddress, (error) => finish(error ?? undefined));
    };

    if (sourceAddress) {
      socket.bind({ address: sourceAddress, port: 0 }, send);
    } else {
      socket.bind(0, send);
    }
  });
}
