import { onlineConfig } from '../onlineConfig.js';

const SERVER_PORT = 5174;

class MultiplayerClient {
    constructor() {
        this.socket = null;
        this.id = null;
        this.connected = false;
        this.handlers = {};
    }

    connect({ profile, roomCode = 'PUBLIC', map = 'neon', onOpen, onClose, onError, onMessage }) {
        this.disconnect();
        this.handlers = { onOpen, onClose, onError, onMessage };
        const room = encodeURIComponent(String(roomCode || 'PUBLIC').toUpperCase());
        this.socket = new WebSocket(`${this.getServerUrl()}?room=${room}`);

        this.socket.addEventListener('open', () => {
            this.connected = true;
            this.send({ type: 'join', profile, map });
            onOpen?.();
        });

        this.socket.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'welcome') {
                this.id = message.id;
            }
            onMessage?.(message);
        });

        this.socket.addEventListener('close', () => {
            this.connected = false;
            onClose?.();
        });

        this.socket.addEventListener('error', () => {
            onError?.();
        });
    }

    getServerUrl() {
        if (onlineConfig.multiplayerServerUrl) {
            return onlineConfig.multiplayerServerUrl.replace(/\/$/, '');
        }
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname || '127.0.0.1';
        return `${protocol}//${host}:${SERVER_PORT}`;
    }

    send(message) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.socket.send(JSON.stringify(message));
    }

    sendState(state) {
        this.send({ type: 'state', ...state });
    }

    sendShoot(shot) {
        this.send({ type: 'shoot', ...shot });
    }

    disconnect() {
        if (this.socket) {
            this.socket.close();
        }
        this.socket = null;
        this.id = null;
        this.connected = false;
        this.handlers = {};
    }
}

export const multiplayerClient = new MultiplayerClient();
