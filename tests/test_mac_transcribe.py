"""Check progressive caption timing without downloading a speech model."""
import contextlib
import io
import json
import tempfile
import unittest
import wave
from pathlib import Path
from desktop import transcribe


class MacTranscriptionTest(unittest.TestCase):
    def test_requested_slice_keeps_book_timestamps(self):
        original = transcribe.recognizer
        transcribe.recognizer = lambda: lambda _path: [{'start': 2.1, 'end': 2.4, 'text': '日本語です。'}]
        try:
            with tempfile.TemporaryDirectory() as folder:
                audio = Path(folder) / 'sample.wav'
                with wave.open(str(audio), 'wb') as out:
                    out.setnchannels(1)
                    out.setsampwidth(2)
                    out.setframerate(16000)
                    out.writeframes(b'\0\x10' * 16000 * 3)
                updates = []
                cues = transcribe.transcribe(str(audio), 2, .5, updates.append)
                self.assertAlmostEqual(cues[0]['start'], 2.1)
                self.assertAlmostEqual(cues[0]['end'], 2.4)
                self.assertEqual(updates[-1]['duration'], .5)
                self.assertEqual(updates[-1]['processedSeconds'], .5)
        finally:
            transcribe.recognizer = original

    def test_chunk_offsets_and_progress(self):
        original = transcribe.recognizer
        transcribe.recognizer = lambda: lambda _path: [{'start': .2, 'end': .8, 'text': '日本語です。'}]
        try:
            with tempfile.TemporaryDirectory() as folder:
                audio = Path(folder) / 'sample.wav'
                with wave.open(str(audio), 'wb') as out:
                    out.setnchannels(1)
                    out.setsampwidth(2)
                    out.setframerate(16000)
                    out.writeframes(b'\0\x10' * 16000)
                progress = io.StringIO()
                with contextlib.redirect_stdout(progress):
                    cues = transcribe.transcribe(str(audio))
                self.assertEqual(cues, [{'start': .2, 'end': .8, 'text': '日本語です。'}])
                updates = [json.loads(line) for line in progress.getvalue().splitlines()]
                self.assertEqual(updates[0]["phase"], "loading")
                update = updates[-1]
                self.assertEqual(update['status'], 'processing')
                self.assertEqual(update['cues'], cues)
                self.assertEqual(update['processedSeconds'], 1)
        finally:
            transcribe.recognizer = original


if __name__ == '__main__':
    unittest.main()

class WarmProgressTest(unittest.TestCase):
    def test_reused_model_does_not_report_a_new_download_or_load(self):
        original, quality = transcribe.recognizer, transcribe._loaded_quality
        transcribe.recognizer = lambda: lambda _: [{'start': .1, 'end': .8, 'text': '日本語'}]
        transcribe._loaded_quality = 'balanced'
        try:
            with tempfile.TemporaryDirectory() as folder:
                audio = Path(folder) / 'speech.wav'
                with wave.open(str(audio), 'wb') as out:
                    out.setnchannels(1); out.setsampwidth(2); out.setframerate(16000)
                    out.writeframes(b'\0\x10' * 16000)
                updates = []
                transcribe.transcribe(str(audio), emit=updates.append)
                self.assertEqual(updates[0]['phase'], 'recognizing')
        finally:
            transcribe.recognizer, transcribe._loaded_quality = original, quality


class SpeechContextTest(unittest.TestCase):
    def test_metadata_hint_is_bounded_and_optional_for_reused_models(self):
        import os
        import sys
        import types
        from unittest.mock import patch
        calls=[]
        stub=types.SimpleNamespace(transcribe=lambda *a,**kw: calls.append(kw) or {'segments':[]})
        with patch.dict(sys.modules,{'mlx_whisper':stub}),patch('platform.machine',return_value='arm64'),patch.dict(os.environ,{'IMMERSED_SPEECH_CONTEXT':'詩人\n'+('名前'*200)}):
            transcribe.recognizer()('sample.wav')
            self.assertLessEqual(len(calls[-1]['initial_prompt']),160)
            self.assertNotIn('\n',calls[-1]['initial_prompt'])
            os.environ['IMMERSED_SPEECH_CONTEXT']=''
            transcribe.recognizer()('another.wav')
            self.assertIsNone(calls[-1]['initial_prompt'])
            self.assertFalse(calls[-1]['condition_on_previous_text'])
