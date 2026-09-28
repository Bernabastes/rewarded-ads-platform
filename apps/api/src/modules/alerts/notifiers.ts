import { Injectable, Logger } from '@nestjs/common';
import type { AlertSeverity } from '@prisma/client';
import { AppConfig } from '../../config/app-config';

export interface AlertMessage {
  id: string;
  type: string;
  severity: AlertSeverity;
  title: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/** Delivery channel for money-day alerts. Implementations must never throw (they return ok/error). */
export interface Notifier {
  readonly name: string;
  readonly isMock: boolean;
  send(alert: AlertMessage): Promise<{ notifier: string; ok: boolean; error?: string }>;
}

export const ALERT_NOTIFIERS = Symbol('ALERT_NOTIFIERS');

const SEVERITY_ICON: Record<AlertSeverity, string> = { info: 'ℹ️', warning: '⚠️', critical: '🚨' };

export function formatAlertText(alert: AlertMessage, adminUrl: string): string {
  const lines = [
    `${SEVERITY_ICON[alert.severity]} [${alert.severity.toUpperCase()}] ${alert.title}`,
    `type: ${alert.type}`,
    ...Object.entries(alert.payload)
      .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
      .slice(0, 12)
      .map(([k, v]) => `${k}: ${String(v)}`),
    `${adminUrl}/alerts/${alert.id}`,
  ];
  return lines.join('\n');
}

/** Logs alerts (default when neither Telegram nor a webhook is configured). */
@Injectable()
export class LogNotifier implements Notifier {
  readonly name = 'log';
  readonly isMock = true;
  private readonly logger = new Logger('AlertNotifier');

  async send(alert: AlertMessage) {
    const line = `[ALERT ${alert.severity}] ${alert.type}: ${alert.title} ${JSON.stringify(alert.payload)}`;
    if (alert.severity === 'critical') this.logger.error(line);
    else if (alert.severity === 'warning') this.logger.warn(line);
    else this.logger.log(line);
    return { notifier: this.name, ok: true };
  }
}

/** Telegram Bot API (`sendMessage`). Real when ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID are set. */
@Injectable()
export class TelegramNotifier implements Notifier {
  readonly name = 'telegram';
  readonly isMock = false;

  constructor(private readonly config: AppConfig) {}

  async send(alert: AlertMessage) {
    const e = this.config.env;
    try {
      const res = await fetch(`https://api.telegram.org/bot${e.ALERT_TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: e.ALERT_TELEGRAM_CHAT_ID,
          text: formatAlertText(alert, e.ADMIN_WEB_URL),
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) return { notifier: this.name, ok: false, error: `HTTP ${res.status}` };
      return { notifier: this.name, ok: true };
    } catch (err) {
      return { notifier: this.name, ok: false, error: (err as Error).message };
    }
  }
}

/** Slack-compatible incoming webhook (`{ text, blocks }`); also fine for Mattermost / Discord-Slack bridges. */
@Injectable()
export class WebhookNotifier implements Notifier {
  readonly name = 'webhook';
  readonly isMock = false;

  constructor(private readonly config: AppConfig) {}

  async send(alert: AlertMessage) {
    const e = this.config.env;
    try {
      const text = formatAlertText(alert, e.ADMIN_WEB_URL);
      const res = await fetch(e.ALERT_WEBHOOK_URL!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: `${alert.severity.toUpperCase()}: ${alert.title}` } },
            { type: 'section', text: { type: 'mrkdwn', text: '```' + JSON.stringify(alert.payload, null, 2) + '```' } },
            {
              type: 'context',
              elements: [{ type: 'mrkdwn', text: `${alert.type} · ${alert.createdAt.toISOString()} · <${e.ADMIN_WEB_URL}/alerts/${alert.id}|open>` }],
            },
          ],
        }),
      });
      if (!res.ok) return { notifier: this.name, ok: false, error: `HTTP ${res.status}` };
      return { notifier: this.name, ok: true };
    } catch (err) {
      return { notifier: this.name, ok: false, error: (err as Error).message };
    }
  }
}

export function buildNotifiers(config: AppConfig): Notifier[] {
  const list: Notifier[] = [];
  if (config.alerts.telegramConfigured) list.push(new TelegramNotifier(config));
  if (config.alerts.webhookConfigured) list.push(new WebhookNotifier(config));
  if (list.length === 0) list.push(new LogNotifier());
  return list;
}
