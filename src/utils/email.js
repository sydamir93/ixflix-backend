const nodemailer = require('nodemailer');
const { logger } = require('./logger');

let transporter;

function buildTransporter() {
  const host = process.env.SES_SMTP_HOST;
  const port = parseInt(process.env.SES_SMTP_PORT || '587', 10);
  const user = process.env.SES_SMTP_USERNAME;
  const pass = process.env.SES_SMTP_PASSWORD;

  if (!host || !user || !pass) {
    throw new Error('SES SMTP settings are not configured');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

function getTransporter() {
  if (!transporter) {
    transporter = buildTransporter();
  }
  return transporter;
}

async function sendPasswordResetEmail(to, name, resetLink) {
  const from = process.env.EMAIL_FROM || process.env.SES_SMTP_USERNAME;
  if (!from) {
    throw new Error('EMAIL_FROM is not configured');
  }

  const safeName = name || 'there';
  const mailOptions = {
    from,
    to,
    subject: 'Reset your IXFLIX password',
    text: [
      `Hi ${safeName},`,
      '',
      'We received a request to reset your IXFLIX password.',
      'Click the link below to set a new password. This link expires soon.',
      resetLink,
      '',
      'If you did not request this, you can ignore this email.',
      '',
      '— The IXFLIX Team'
    ].join('\n'),
    html: `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0b0b0f;padding:32px 0;">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#111827;border:1px solid #1f2937;border-radius:12px;overflow:hidden;color:#e5e7eb;font-family:Arial, sans-serif;">
              <tr>
                <td style="padding:28px 32px;background:#0f172a;border-bottom:1px solid #1f2937;">
                  <table role="presentation" width="100%">
                    <tr>
                      <td style="font-size:18px;font-weight:700;color:#f8fafc;">IXFLIX</td>
                      <td align="right" style="font-size:12px;color:#94a3b8;">Secure Account Access</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:28px 32px;">
                  <p style="margin:0 0 12px;font-size:16px;color:#f8fafc;">Hi ${safeName},</p>
                  <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#cbd5e1;">
                    We received a request to reset your IXFLIX password. Click the button below to create a new one. This link will expire soon for your security.
                  </p>
                  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
                    <tr>
                      <td align="center">
                        <a href="${resetLink}" style="display:inline-block;background:#e50914;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700;font-size:14px;">
                          Reset password
                        </a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#9ca3af;">
                    If the button does not work, copy and paste this link into your browser:
                  </p>
                  <p style="margin:0 0 16px;font-size:12px;line-height:1.6;color:#cbd5e1;word-break:break-all;">${resetLink}</p>
                  <p style="margin:0;font-size:13px;line-height:1.6;color:#9ca3af;">
                    If you did not request this, you can safely ignore this email—your password will remain unchanged.
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 32px;background:#0f172a;border-top:1px solid #1f2937;font-size:12px;color:#6b7280;">
                  <p style="margin:0 0 6px;">Need help? Contact support at <a href="mailto:support@ixflix.io" style="color:#e50914;text-decoration:none;">support@ixflix.com</a></p>
                  <p style="margin:0;">© ${new Date().getFullYear()} IXFLIX. All rights reserved.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    `
  };

  try {
    await getTransporter().sendMail(mailOptions);
    logger.info('Password reset email sent', {
      to,
      event: 'password_reset_email_sent',
      meta: { type: 'email' }
    });
  } catch (err) {
    logger.error('Failed to send password reset email', {
      to,
      error: err.message,
      stack: err.stack,
      meta: { type: 'email' }
    });
    throw err;
  }
}

module.exports = {
  sendPasswordResetEmail
};

