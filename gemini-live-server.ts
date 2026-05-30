// To run this code you need to install the following dependencies:
// npm install @google/genai
// npm install -D @types/node
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import {
  GoogleGenAI,
  LiveServerMessage,
  MediaResolution,
  Modality,
  Session,
  Type,
} from '@google/genai';
import { writeFile } from 'fs';
import * as http from 'http';
import { exec } from 'child_process';

const responseQueue: LiveServerMessage[] = [];
let session: Session | undefined = undefined;

async function handleTurn(): Promise<LiveServerMessage[]> {
  const turn: LiveServerMessage[] = [];
  let done = false;
  while (!done) {
    const message = await waitMessage();
    turn.push(message);
    if (message.serverContent && message.serverContent.turnComplete) {
      done = true;
    }
  }
  return turn;
}

async function waitMessage(): Promise<LiveServerMessage> {
  let done = false;
  let message: LiveServerMessage | undefined = undefined;
  while (!done) {
    message = responseQueue.shift();
    if (message) {
      handleModelTurn(message);
      done = true;
    } else {
      await new Promise((resolve) => { setTimeout(resolve, 100); });
    }
  }
  return message!;
}

const audioParts: string[] = [];
function handleModelTurn(message: LiveServerMessage) {
  if(message.toolCall) {
    message.toolCall.functionCalls?.forEach(
      functionCall => { console.log('Execute function ' + functionCall.name + ' with arguments: ' + JSON.stringify(functionCall.args)); }
    );

    session?.sendToolResponse({
      functionResponses:
        message.toolCall.functionCalls?.map(functionCall => ({
          id: functionCall.id,
          name: functionCall.name,
          response: {response: 'INPUT_RESPONSE_HERE'}
        })) ?? []
    });
  }

  if(message.serverContent?.modelTurn?.parts) {
    const part = message.serverContent?.modelTurn?.parts?.[0];

    if(part?.fileData) {
      console.log('File: ' + part?.fileData.fileUri);
    }

    if (part?.inlineData) {
      const fileName = 'audio.wav';
      const inlineData = part?.inlineData;

      audioParts.push(inlineData?.data ?? '');

      const buffer = convertToWav(audioParts, inlineData.mimeType ?? '');
      saveBinaryFile(fileName, buffer);
    }

    if(part?.text) {
      console.log(part?.text);
    }
  }
}

function saveBinaryFile(fileName: string, content: Buffer) {
  // @ts-ignore
  writeFile(fileName, content, 'utf8', (err) => {
    if (err) {
      console.error('Error writing file ' + fileName + ':', err);
      return;
    }
    console.log('Appending stream content to file ' + fileName + '.');
  });
}

interface WavConversionOptions {
  numChannels : number,
  sampleRate: number,
  bitsPerSample: number
}

function convertToWav(rawData: string[], mimeType: string) {
  const options = parseMimeType(mimeType);
  const dataLength = rawData.reduce((a, b) => a + b.length, 0);
  const wavHeader = createWavHeader(dataLength, options);
  const buffer = Buffer.concat(
  // @ts-ignore
    rawData.map(data => Buffer.from(data, 'base64')));

  // @ts-ignore
  return Buffer.concat([wavHeader, buffer]);
}

function parseMimeType(mimeType : string) {
  const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
  const [, format] = fileType.split('/');

  const options : Partial<WavConversionOptions> = {
    numChannels: 1,
    bitsPerSample: 16,
  };

  if (format && format.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) {
      options.bitsPerSample = bits;
    }
  }

  for (const param of params) {
    const [key, value] = param.split('=').map(s => s.trim());
    if (key === 'rate') {
      options.sampleRate = parseInt(value, 10);
    }
  }

  return options as WavConversionOptions;
}

function createWavHeader(dataLength: number, options: WavConversionOptions) {
  const {
    numChannels,
    sampleRate,
    bitsPerSample,
  } = options;

  // http://soundfile.sapp.org/doc/WaveFormat

  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0);                      // ChunkID
  buffer.writeUInt32LE(36 + dataLength, 4);     // ChunkSize
  buffer.write('WAVE', 8);                      // Format
  buffer.write('fmt ', 12);                     // Subchunk1ID
  buffer.writeUInt32LE(16, 16);                 // Subchunk1Size (PCM)
  buffer.writeUInt16LE(1, 20);                  // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);        // NumChannels
  buffer.writeUInt32LE(sampleRate, 24);         // SampleRate
  buffer.writeUInt32LE(byteRate, 28);           // ByteRate
  buffer.writeUInt16LE(blockAlign, 32);         // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34);      // BitsPerSample
  buffer.write('data', 36);                     // Subchunk2ID
  buffer.writeUInt32LE(dataLength, 40);         // Subchunk2Size

  return buffer;
}

async function runGeminiLive(barcode: string, language: string = 'en') {
  console.log('[Gemini] Connecting for barcode: ' + barcode + ' language: ' + language);

  // Clear audio parts from previous run
  audioParts.length = 0;

  const ai = new GoogleGenAI({
    apiKey: process.env['GEMINI_API_KEY'],
  });

  const model = 'models/gemini-3.1-flash-live-preview'

  const tools = [
    { googleSearch: {} },
    {
      functionDeclarations: [
      ],
    }
  ];

  const config = {
    responseModalities: [
        Modality.AUDIO,
    ],
    mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: 'Aoede',
        }
      }
    },
    contextWindowCompression: {
        triggerTokens: '104857',
        slidingWindow: { targetTokens: '52428' },
    },
    tools,
    systemInstruction: {
      parts: [{
        text: 'CRITICAL: You MUST respond ONLY in language code: ' + language + '. Speak natively in that language for your entire response. When you receive a scanner output, instantly run a google search and formulate a brief information details about the product, and read aloud to the user in high human nuance in the language ' + language + '. Include a short piece of trivia or knowledge about the product. Keep it concise, about 3 to 4 sentences, unless the user asks for more detail. Example: if you receive "product scanner output 48042772", search and respond with something like the product name and a fun fact about it.',
      }]
    },
  };

  session = await ai.live.connect({
    model,
    callbacks: {
      onopen: function () {
        console.log('[Gemini] Session opened');
      },
      onmessage: function (message: LiveServerMessage) {
        responseQueue.push(message);
      },
      onerror: function (e: ErrorEvent) {
        console.error('[Gemini] Error:', e.message);
      },
      onclose: function (e: CloseEvent) {
        console.log('[Gemini] Session closed:', e.reason);
      },
    },
    config
  });

  // Send scanner output as the input prompt
  session.sendClientContent({
    turns: [
      'product scanner output ' + barcode
    ]
  });

  await handleTurn();

  session.close();
  console.log('[Gemini] Turn complete. Audio saved to audio.wav');

  // Auto-play the generated audio on macOS
  exec('afplay audio.wav', (err) => {
    if (err) {
      console.error('[Audio] Playback error:', err.message);
    } else {
      console.log('[Audio] Playback finished.');
    }
  });
}

// ─── Webhook Server ───────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        if (data.barcode) {
          console.log('[Webhook] Received barcode: ' + data.barcode + ' lang: ' + (data.language || 'en'));

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', barcode: data.barcode }));

          // Fire Gemini Live in background
          runGeminiLive(data.barcode, data.language || 'en').catch(err => {
            console.error('[Gemini] Failed:', err);
          });

        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No barcode in request body' }));
        }
      } catch (err) {
        console.error('[Webhook] Parse error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('  Gemini Live Scanner Server');
  console.log('  Listening on port ' + PORT);
  console.log('');
  console.log('  Set your scanner Webhook URL to:');
  console.log('  http://localhost:' + PORT);
  console.log('='.repeat(60));
});
