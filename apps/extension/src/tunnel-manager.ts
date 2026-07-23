import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { bin, install, use, Tunnel } from 'cloudflared';

import { RuntimeStateStore } from './runtime-state';
import { config } from './runtime-state/config';

import type { LogEntry, TunnelState } from '@ungate/shared/frontend';

const CLOUDFLARED_BIN_DIR = path.join(os.homedir(), '.ungate', 'bin');

function getCloudflaredBinPath(): string {
	return path.join(CLOUDFLARED_BIN_DIR, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}

function getCloudflaredLegacyBinPath(): string {
	return path.join(CLOUDFLARED_BIN_DIR, 'cloudflared');
}

function getCloudflaredConfigArg(): string {
	return process.platform === 'win32' ? 'NUL' : '/dev/null';
}

export class TunnelManager {
	private tunnel: Tunnel | null = null;
	private state: TunnelState = { status: 'stopped', url: null, error: null };
	private readonly windowId: string;
	private autoStopTimer: NodeJS.Timeout | null = null;
	private readinessTimer: NodeJS.Timeout | null = null;
	private pendingUrl: string | null = null;

	constructor(
		windowId: string,
		private readonly isExtensionHostActive: () => boolean,
		private readonly onStateChange: (state: TunnelState) => void,
		private readonly onLog: (entry: LogEntry) => void
	) {
		this.windowId = windowId;
	}

	getState(): TunnelState {
		return { ...this.state };
	}

	async start(port: number): Promise<void> {
		if (this.state.status === 'running') {
			return;
		}

		if (this.tunnel) {
			this.tunnel.stop();
			this.tunnel = null;
		}

		this.setState({ status: 'starting', url: null, error: null });

		await this.ensureBinary();

		if (this.state.status === 'error') {
			return;
		}

		this.spawnTunnel(port);
		this.scheduleAutoStop();
	}

	stop(): void {
		this.clearReadinessTimer();
		this.pendingUrl = null;
		if (this.autoStopTimer) {
			clearInterval(this.autoStopTimer);
			this.autoStopTimer = null;
		}

		if (this.tunnel) {
			this.tunnel.stop();
			this.tunnel = null;
		}

		this.setState({ status: 'stopped', url: null, error: null });
	}

	async restart(port: number): Promise<void> {
		this.stop();
		await this.start(port);
	}

	private async ensureBinary(): Promise<void> {
		const devBinExists = fs.existsSync(bin);
		const userBinPath = this.resolveUserBinaryPath();

		if (devBinExists) {
			return;
		}

		if (userBinPath) {
			use(userBinPath);

			return;
		}

		this.setState({ status: 'installing', url: null, error: null });
		this.onLog({ timestamp: Date.now(), level: 'info', message: 'Downloading cloudflared binary...' });

		try {
			fs.mkdirSync(CLOUDFLARED_BIN_DIR, { recursive: true });
			const installPath = getCloudflaredBinPath();
			const installedPath = await install(installPath);

			use(installedPath);
			this.onLog({ timestamp: Date.now(), level: 'info', message: 'cloudflared installed successfully' });
			this.setState({ status: 'starting', url: null, error: null });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.onLog({ timestamp: Date.now(), level: 'error', message: `Failed to install cloudflared: ${message}` });
			this.setState({ status: 'error', url: null, error: `Install failed: ${message}` });
		}
	}

	private resolveUserBinaryPath(): string | null {
		const binPath = getCloudflaredBinPath();

		if (fs.existsSync(binPath)) {
			return binPath;
		}

		const legacyPath = getCloudflaredLegacyBinPath();

		if (process.platform === 'win32' && fs.existsSync(legacyPath)) {
			fs.renameSync(legacyPath, binPath);

			return binPath;
		}

		return null;
	}

	private spawnTunnel(port: number): void {
		const t = Tunnel.quick(`http://localhost:${port}`, {
			'--config': getCloudflaredConfigArg(),
			'--edge-ip-version': '4'
		});
		this.tunnel = t;
		this.pendingUrl = null;
		this.startReadinessTimer();

		t.on('url', (url) => {
			this.pendingUrl = url;
			this.onLog({ timestamp: Date.now(), level: 'info', message: `Tunnel URL allocated; waiting for Cloudflare connector registration: ${url}` });
		});

		t.on('stderr', (data) => {
			const lines = data.split('\n').filter((l) => l.trim());

			for (const line of lines) {
				this.onLog({ timestamp: Date.now(), level: 'info', message: line });
				if (line.includes('Registered tunnel connection') && this.pendingUrl && this.state.status === 'starting') {
					const url = this.pendingUrl;
					this.clearReadinessTimer();
					this.setState({ status: 'running', url, error: null });
					this.scheduleAutoStop();
				}
			}
		});

		t.on('error', (err) => {
			const message = err.message;
			this.clearReadinessTimer();
			this.pendingUrl = null;
			this.onLog({ timestamp: Date.now(), level: 'error', message: `Tunnel error: ${message}` });
			this.setState({ status: 'error', url: null, error: message });
		});

		t.on('exit', (code, signal) => {
			this.onLog({ timestamp: Date.now(), level: 'warn', message: `Tunnel exited code=${code} signal=${signal}` });

			this.clearReadinessTimer();
			this.pendingUrl = null;
			const wasStarting = this.state.status === 'starting';

			if (this.state.status !== 'stopped') {
				const reason = wasStarting
					? `Process exited before tunnel was ready (code=${code}, signal=${signal})`
					: `Cloudflare connector exited unexpectedly (code=${code}, signal=${signal}). Restart the tunnel to create a new URL.`;
				const next: TunnelState = { status: 'error', url: null, error: reason };

				this.setState(next);
			}

			this.tunnel = null;
		});
	}

	private startReadinessTimer(): void {
		this.clearReadinessTimer();
		this.readinessTimer = setTimeout(() => {
			if (this.state.status !== 'starting') {
				return;
			}

			this.tunnel?.stop();
			this.tunnel = null;
			this.pendingUrl = null;
			this.setState({
				status: 'error',
				url: null,
				error: 'Cloudflare did not register the tunnel connector before the readiness timeout. Retry Restart Tunnel.'
			});
			this.onLog({ timestamp: Date.now(), level: 'error', message: 'Tunnel readiness timed out before Cloudflare registered its connector.' });
		}, config.tunnelManager.readinessTimeoutMs);
	}

	private clearReadinessTimer(): void {
		if (this.readinessTimer) {
			clearTimeout(this.readinessTimer);
			this.readinessTimer = null;
		}
	}

	private setState(next: TunnelState): void {
		this.state = next;
		void this.persistTunnelState(next).catch(() => {});
	}

	private async persistTunnelState(next: TunnelState): Promise<void> {
		await RuntimeStateStore.mutate((current) => {
			current.tunnel.status = next.status;
			current.tunnel.url = next.url;
			current.tunnel.lastSeenAt = Date.now();
			current.tunnel.lastError = next.error;
			current.tunnel.ownerWindowId = this.windowId;

			return current;
		});
		this.onStateChange(next);
	}

	private scheduleAutoStop(): void {
		if (this.autoStopTimer) {
			return;
		}

		this.autoStopTimer = setInterval(() => {
			const runtimeState = RuntimeStateStore.read();
			const hasLiveClientsOnDisk = RuntimeStateStore.hasLiveClients(runtimeState);

			if (!hasLiveClientsOnDisk && !this.isExtensionHostActive()) {
				this.stop();
			}
		}, config.tunnelManager.autoStopCheckIntervalMs);
	}
}
