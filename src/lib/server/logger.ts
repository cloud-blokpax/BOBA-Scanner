/**
 * Structured JSON logger for server-side request tracing.
 *
 * Every log entry includes a requestId for correlation.
 * Output is JSON — Vercel captures it in the Logs tab and it's
 * searchable in any JSON log aggregator.
 */

export interface LogContext {
	requestId: string;
	userId?: string;
	path?: string;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function formatLog(level: LogLevel, ctx: LogContext, message: string, data?: Record<string, unknown>): string {
	return JSON.stringify({
		level,
		ts: new Date().toISOString(),
		reqId: ctx.requestId,
		userId: ctx.userId || undefined,
		path: ctx.path || undefined,
		msg: message,
		...data
	});
}

export function createLogger(ctx: LogContext) {
	return {
		debug: (msg: string, data?: Record<string, unknown>) => console.debug(formatLog('debug', ctx, msg, data)),
		info: (msg: string, data?: Record<string, unknown>) => console.log(formatLog('info', ctx, msg, data)),
		warn: (msg: string, data?: Record<string, unknown>) => console.warn(formatLog('warn', ctx, msg, data)),
		error: (msg: string, data?: Record<string, unknown>) => console.error(formatLog('error', ctx, msg, data)),
	};
}
