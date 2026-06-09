import dotenv from 'dotenv';

dotenv.config();

const webhookUrl = process.env.SLACK_WEBHOOK_URL;

/**
 * Sends a notification to Slack or prints to stdout in offline mock mode.
 * @param {string} message The message body.
 */
export async function sendSlackNotification(message) {
  if (webhookUrl && webhookUrl !== 'https://hooks.slack.com/services/mock/webhook/url') {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message })
      });
      if (!response.ok) {
        console.error(`Slack webhook error: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to dispatch Slack webhook notification:', error);
    }
  } else {
    console.log(`[Slack Notification Mock] Channel #notifications: ${message}`);
  }
}

export default {
  sendSlackNotification
};
