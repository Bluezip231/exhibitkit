/**
 * sample.js — a small fictional WhatsApp-format chat so visitors can try
 * the whole pipeline (hashing, parsing, selecting, redacting, generating)
 * without exporting anything first.
 *
 * The sample goes through the exact same code path as a real upload: it is
 * wrapped in a File object, hashed, detected and parsed normally.
 */

const LINES = [
  '[5/3/26, 9:12:04 AM] Jane Smith: Are you picking Emma up from school on Friday?',
  '[5/3/26, 9:14:30 AM] John Smith: Yes, 3pm. I can drop her back Sunday at 6.',
  '[5/3/26, 9:15:02 AM] Jane Smith: That works. Please remember her allergy medicine this time.',
  '[5/3/26, 9:20:45 AM] John Smith: I will.',
  '[5/7/26, 6:02:11 PM] Jane Smith: You said the support payment would come through Monday. It is Thursday.',
  '[5/7/26, 6:40:09 PM] John Smith: Money is tight. You will get it when you get it.',
  '[5/7/26, 6:41:33 PM] Jane Smith: That is the second month in a row it has been late.',
  '[5/12/26, 8:30:00 AM] John Smith: I can do $300 now and the rest on the 20th.',
  'Send me your account number again.',
  '[5/12/26, 8:33:21 AM] Jane Smith: It is 4417-220-9981, same as before.',
  '[5/12/26, 8:35:00 AM] John Smith: Got it.',
  '[5/19/26, 7:15:44 PM] Jane Smith: Emma said you did not show up for pickup today. She waited 40 minutes.',
  '[5/19/26, 8:02:10 PM] John Smith: Something came up at work. I texted you.',
  '[5/19/26, 8:03:05 PM] Jane Smith: No, you did not. This is the third missed pickup since March.',
  '[5/26/26, 1:11:09 PM] John Smith: Fine. New schedule starting June: I take her Wednesdays and every other weekend 😀',
  '[5/26/26, 1:14:27 PM] Jane Smith: Put that in writing through the parenting app please.',
  '[6/1/26, 10:05:18 AM] John Smith: \u200e<Media omitted>',
  '[6/1/26, 10:06:00 AM] John Smith: That is the receipt for May.',
  '[6/1/26, 10:09:41 AM] Jane Smith: Received, thank you.',
];

const PREAMBLE =
  '\u200e[5/3/26, 9:11:50 AM] Messages and calls are end-to-end encrypted. ' +
  'No one outside of this chat, not even WhatsApp, can read or listen to them.';

export const SAMPLE_FILE_NAME = 'Sample WhatsApp Chat (fictional).txt';

export function makeSampleFile() {
  const text = [PREAMBLE, ...LINES].join('\n');
  return new File([text], SAMPLE_FILE_NAME, {
    type: 'text/plain',
    lastModified: Date.now(),
  });
}
