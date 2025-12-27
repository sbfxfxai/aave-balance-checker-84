import { VercelRequest, VercelResponse } from '@vercel/node';
import formData from 'form-data';
import Mailgun from 'mailgun.js';

const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY || '',
  domain: process.env.MAILGUN_DOMAIN || '',
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, wallet_address, mnemonic, name } = req.body;

    if (!email || !wallet_address || !mnemonic) {
      return res.status(400).json({ 
        error: 'Missing required fields: email, wallet_address, mnemonic' 
      });
    }

    const emailContent = `
Hello ${name || 'there'},

Your deposit was successful! Here are your wallet details:

Wallet Address: ${wallet_address}
Recovery Phrase: ${mnemonic}

IMPORTANT: Save this recovery phrase securely. You'll need it to access your wallet if you lose access to your device.

Your funds will be deposited to this wallet shortly. You can check your balance on the dashboard at https://www.tiltvault.com

If you have any questions, please contact support.

Best regards,
TiltVault Team
    `.trim();

    const data = {
      from: `TiltVault <noreply@${process.env.MAILGUN_DOMAIN}>`,
      to: email,
      subject: 'Your TiltVault Wallet Details - Save This Email!',
      text: emailContent,
      html: emailContent.replace(/\n/g, '<br>')
    };

    const response = await mg.messages.create(process.env.MAILGUN_DOMAIN!, data);
    
    console.log('[Send Email] Email sent successfully:', {
      to: email,
      messageId: response.id
    });

    res.status(200).json({ 
      success: true,
      messageId: response.id
    });

  } catch (error) {
    console.error('[Send Email] Error:', error);
    
    res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send email'
    });
  }
}
