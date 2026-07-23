import { GrokRuntime } from 'src/auth/grok/grok-runtime';
import { CompletionRequestTelemetry } from 'src/metrics';

import type { ModelMappingConfig } from '@ungate/shared';
import type { FastifyReply } from 'fastify';
import type { OpenAIChatRequest, OpenAIChatResponse, OpenAIStreamChunk } from 'src/types/openai';

export class GrokChatHandler {
	static async handle(openaiBody: OpenAIChatRequest, resolvedModel: ModelMappingConfig, reply: FastifyReply): Promise<FastifyReply> {
		const model = resolvedModel.upstreamModel || 'grok-build';
		const startedAt = Date.now();
		if (openaiBody.stream) return this.stream(openaiBody, model, startedAt, reply);

		let content = '';
		await GrokRuntime.complete({ request: openaiBody, model, onText: (text) => (content += text) });
		const latencyMs = Date.now() - startedAt;
		CompletionRequestTelemetry.recordAndApplyProxyHeaders(reply, latencyMs, {
			model,
			source: 'grok',
			inputTokens: this.estimateTokens(openaiBody),
			outputTokens: this.estimateTokens(content),
			stream: false,
			latencyMs
		});
		const response: OpenAIChatResponse = {
			id: `chatcmpl-grok-${Date.now()}`,
			object: 'chat.completion',
			created: Math.floor(Date.now() / 1_000),
			model: openaiBody.model,
			choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
			usage: {
				prompt_tokens: this.estimateTokens(openaiBody),
				completion_tokens: this.estimateTokens(content),
				total_tokens: this.estimateTokens(openaiBody) + this.estimateTokens(content)
			}
		};
		return reply.send(response);
	}

	private static stream(openaiBody: OpenAIChatRequest, model: string, startedAt: number, reply: FastifyReply): FastifyReply {
		const encoder = new TextEncoder();
		const id = `chatcmpl-grok-${Date.now()}`;
		let content = '';
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const send = (chunk: OpenAIStreamChunk) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
				send({
					id,
					object: 'chat.completion.chunk',
					created: Math.floor(Date.now() / 1_000),
					model: openaiBody.model,
					choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
				});
				void GrokRuntime.complete({
					request: openaiBody,
					model,
					onText: (text) => {
						content += text;
						send({
							id,
							object: 'chat.completion.chunk',
							created: Math.floor(Date.now() / 1_000),
							model: openaiBody.model,
							choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
						});
					}
				})
					.then(() => {
						CompletionRequestTelemetry.record({
							model,
							source: 'grok',
							inputTokens: GrokChatHandler.estimateTokens(openaiBody),
							outputTokens: GrokChatHandler.estimateTokens(content),
							stream: true,
							latencyMs: Date.now() - startedAt
						});
						send({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1_000), model: openaiBody.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
						controller.enqueue(encoder.encode('data: [DONE]\n\n'));
						controller.close();
					})
					.catch((error: unknown) => {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error), type: 'grok_error' } })}\n\n`));
						controller.enqueue(encoder.encode('data: [DONE]\n\n'));
						controller.close();
					});
			}
		});
		reply.header('content-type', 'text/event-stream; charset=utf-8');
		reply.header('cache-control', 'no-cache');
		reply.header('connection', 'keep-alive');
		return reply.send(stream);
	}

	private static estimateTokens(value: unknown): number {
		return Math.ceil(JSON.stringify(value).length / 4);
	}
}
