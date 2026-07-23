import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const handlers = new Map<string, (value: never, second?: never) => void>();
	return {
		handlers,
		quick: vi.fn(() => ({
			on: (event: string, handler: (value: never, second?: never) => void) => handlers.set(event, handler),
			stop: vi.fn()
		})),
		mutate: vi.fn((mutator: (state: { tunnel: Record<string, unknown> }) => unknown) => Promise.resolve(mutator({ tunnel: {} })))
	};
});

vi.mock('cloudflared', () => ({ bin: '/dev/null', install: vi.fn(), use: vi.fn(), Tunnel: { quick: mocks.quick } }));
vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true) }));
vi.mock('../../src/runtime-state', () => ({
	RuntimeStateStore: { mutate: mocks.mutate, read: vi.fn(() => ({ clients: {} })), hasLiveClients: vi.fn(() => true) }
}));

import { TunnelManager } from '../../src/tunnel-manager';

describe('TunnelManager readiness', () => {
	afterEach(() => {
		mocks.handlers.clear();
		vi.clearAllMocks();
	});

	it('does not expose a quick-tunnel URL until the connector registers', async () => {
		const states: Array<{ status: string; url: string | null }> = [];
		const manager = new TunnelManager('window-a', () => true, (state) => states.push(state), () => {});

		await manager.start(47821);
		mocks.handlers.get('url')?.('https://allocated.trycloudflare.com' as never);

		expect(manager.getState()).toMatchObject({ status: 'starting', url: null });
		mocks.handlers.get('stderr')?.('Registered tunnel connection abc' as never);
		expect(manager.getState()).toMatchObject({ status: 'running', url: 'https://allocated.trycloudflare.com' });
		await Promise.resolve();
		expect(states.at(-1)).toMatchObject({ status: 'running', url: 'https://allocated.trycloudflare.com' });
	});
});
