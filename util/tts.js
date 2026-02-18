const axios = require('axios');
const fs = require('fs');

function getEmotion(input) {
    if (input.includes('!')) return { ref_audio: '0003554560_0003677120', prompt_text: '구조가... 선명하게 보여요!' };
    return { ref_audio: '0003821440_0003999040', prompt_text: '고생한 보람이 있네요... 새로운 물자.' };
}

const generateTTS = async function generateVoice(text) {
    try {
        text = text.replace(/[ㄱ-ㅎㅏ-ㅣ]/g, '');
        const { ref_audio, prompt_text } = getEmotion(text);
        const response = await axios.get('http://localhost:9880/tts', {
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
            },
            responseType: 'arraybuffer',
            timeout: 200000,
        });
        const audioBuffer = Buffer.from(response.data);
        fs.writeFileSync('output_voice.wav', audioBuffer);
        return audioBuffer;
    }
    catch (err) {
        console.error(err);
    }
};

module.exports = { generateTTS };