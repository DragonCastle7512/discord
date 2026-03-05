const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function getEmotion(input) {
    if (input.includes('!')) return { ref_audio: '0003554560_0003677120', prompt_text: '구조가... 선명하게 보여요!' };
    return { ref_audio: '0003821440_0003999040', prompt_text: '고생한 보람이 있네요... 새로운 물자.' };
}

function wavSoundUp(buffer, gain = 1.8) {
    const out = Buffer.from(buffer);

    // WAV 헤더(44바이트) 이후 샘플(16-bit PCM little-endian) 증폭
    for (let i = 44; i + 1 < out.length; i += 2) {
      const s = out.readInt16LE(i);
      let v = Math.round(s * gain);
      if (v > 32767) v = 32767;
      if (v < -32768) v = -32768;
      out.writeInt16LE(v, i);
    }

    return out;
  }

async function normalizeWavWithFfmpeg(buffer) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const inputPath = path.join(os.tmpdir(), `tts-input-${id}.wav`);
    const outputPath = path.join(os.tmpdir(), `tts-norm-${id}.wav`);

    try {
        fs.writeFileSync(inputPath, buffer);
        await execFileAsync('ffmpeg', [
            '-y',
            '-i',
            inputPath,
            '-af',
            'loudnorm=I=-14:TP=-1.5:LRA=11',
            outputPath,
        ]);
        return fs.readFileSync(outputPath);
    }
    finally {
        try {
            fs.unlinkSync(inputPath);
        }
        catch (err) {
            console.error(err);
        }
        try {
            fs.unlinkSync(outputPath);
        }
        catch (err) {
            console.error(err);
        }
    }
}

const generateTTS = async function generateVoice(text) {
    try {
        text = text.replace(/[ㄱ-ㅎㅏ-ㅣ]/g, '');
        const { ref_audio, prompt_text } = getEmotion(text);
        const response = await axios.get(`${process.env.TTS_SERVER_URL}/tts`, {
            params: {
                text: text,
                text_lang: 'ko',
                gpt_model_path: 'GPT_weights_v2Pro/chisa-e15.ckpt',
                sovits_model_path: 'SoVITS_weights_v2Pro/chisa_e8_s648.pth',
                ref_audio_path: `/workspace/GPT-SoVITS/output/slicer_opt/chisa.wav_${ref_audio}.wav`,
                prompt_text: prompt_text,
                prompt_lang: 'ko',
                top_k: 12,
                top_p: 0.8,
                temperature: 0.75,
                speed_factor: 1.05,
                fragment_interval: 0.3,
                is_half: true,
            },
            responseType: 'arraybuffer',
            timeout: 200000,
        });
        const audioBuffer = Buffer.from(response.data);
        let louder = wavSoundUp(audioBuffer, 1.7);

        try {
            louder = await normalizeWavWithFfmpeg(louder);
        }
        catch (error) {
            console.error(error);
        }

        fs.writeFileSync('output_voice.wav', louder);
        return louder;
    }
    catch (err) {
        console.error(err);
    }
};

module.exports = { generateTTS };
