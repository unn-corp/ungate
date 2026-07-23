import { and, eq } from 'drizzle-orm';

import { providerSettings } from './schema';

import { getDb } from './index';

import type { AIProviderName, OAuthCredentials } from '../auth/base-provider';

export class ProviderSettings {
	static get(provider: AIProviderName) {
		const db = getDb();

		return db.select().from(providerSettings).where(and(eq(providerSettings.provider, provider), eq(providerSettings.isActive, true))).get();
	}

	static list(provider: AIProviderName) {
		return getDb().select().from(providerSettings).where(eq(providerSettings.provider, provider)).all();
	}

	static activate(provider: AIProviderName, accountKey: string): boolean {
		const db = getDb();
		const account = db.select().from(providerSettings).where(and(eq(providerSettings.provider, provider), eq(providerSettings.accountKey, accountKey))).get();
		if (!account) return false;
		db.update(providerSettings).set({ isActive: false }).where(eq(providerSettings.provider, provider)).run();
		db.update(providerSettings).set({ isActive: true }).where(and(eq(providerSettings.provider, provider), eq(providerSettings.accountKey, accountKey))).run();
		return true;
	}

	static upsertApiKey(provider: AIProviderName, accessToken: string, baseUrl?: string): void {
		const db = getDb();

		db.insert(providerSettings)
			.values({
				provider, accountKey: 'default', isActive: true,
				accessToken,
				createdAt: Date.now(),
				...(baseUrl && { baseUrl })
			})
			.onConflictDoUpdate({
				target: [providerSettings.provider, providerSettings.accountKey],
				set: {
					accessToken,
					...(baseUrl !== undefined && { baseUrl })
				}
			})
			.run();
	}

	static upsertOAuth(provider: AIProviderName, data: OAuthCredentials): void {
		const db = getDb();
		const accountKey = data.accountKey ?? data.accountId ?? data.email ?? 'default';
		db.update(providerSettings).set({ isActive: false }).where(eq(providerSettings.provider, provider)).run();

		db.insert(providerSettings)
			.values({
				provider, accountKey, isActive: true,
				accessToken: data.accessToken,
				refreshToken: data.refreshToken,
				expiresAt: data.expiresAt,
				email: data.email ?? null,
				accountId: data.accountId ?? null,
				createdAt: Date.now()
			})
			.onConflictDoUpdate({
				target: [providerSettings.provider, providerSettings.accountKey],
				set: {
					accessToken: data.accessToken,
					refreshToken: data.refreshToken,
					expiresAt: data.expiresAt,
					email: data.email ?? null,
					accountId: data.accountId ?? null
				}
			})
			.run();
	}

	static updateBaseUrl(provider: AIProviderName, baseUrl: string): boolean {
		const db = getDb();
		const existing = this.get(provider);

		if (!existing) {
			return false;
		}

		db.update(providerSettings).set({ baseUrl }).where(eq(providerSettings.provider, provider)).run();

		return true;
	}

	static remove(provider: AIProviderName): void {
		const active = this.get(provider);
		if (active) this.removeAccount(provider, active.accountKey);
	}

	static removeAccount(provider: AIProviderName, accountKey: string): void {
		const db = getDb();
		db.delete(providerSettings).where(and(eq(providerSettings.provider, provider), eq(providerSettings.accountKey, accountKey))).run();
		const replacement = this.list(provider)[0];
		if (replacement) this.activate(provider, replacement.accountKey);
	}
}
