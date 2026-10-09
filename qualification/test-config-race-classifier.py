import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('classifier', pathlib.Path(__file__).with_name('config-race-classifier.py'))
classifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(classifier)


class ClassifierTest(unittest.TestCase):
    def test_new_prompt_wins_over_coalesced_old_tool_result(self):
        content = [{'type': 'tool_result', 'tool_use_id': 'config_tool_0'}, {'type': 'text', 'text': classifier.SECOND_PROMPT}]
        self.assertEqual(classifier.request_stage(content), 2)

    def test_new_result_completes_even_with_prior_prompt_in_history(self):
        content = [{'type': 'text', 'text': classifier.SECOND_PROMPT}, {'type': 'tool_result', 'tool_use_id': 'config_tool_1'}]
        self.assertEqual(classifier.request_stage(content), 3)

    def test_original_turn_and_unknown_content(self):
        self.assertEqual(classifier.request_stage([{'type': 'text', 'text': classifier.FIRST_PROMPT}]), 0)
        self.assertEqual(classifier.request_stage([{'type': 'tool_result', 'tool_use_id': 'config_tool_0'}]), 1)
        self.assertEqual(classifier.request_stage([{'type': 'text', 'text': 'Unrelated auxiliary'}]), -1)

    def test_bounded_helper_receipts_and_error_codes(self):
        values = classifier.helper_diagnostics('CONFIG_HELPER_2_PROCESS_REJECTED_N_3_0_0_0_0')
        self.assertEqual(values[2]['ordinal'], 2)
        self.assertEqual(values[2]['exitCode'], None)
        self.assertEqual(values[2]['elapsedBucket'], 3)
        self.assertEqual(classifier.helper_diagnostics('CONFIG_HELPER_1_PRIVATE_0_0_0_0_0_0'), {})
        self.assertEqual(classifier.helper_diagnostics('CONFIG_HELPER_1_DECLARED_OK_2147483648_0_0_0_0_1'), {})
        self.assertEqual(classifier.second_tool_code({'is_error': True, 'content': [{'text': 'Tool withheld: REDACTON_WITHHELD'}]}), 'REDACTON_WITHHELD')
        self.assertEqual(classifier.second_tool_code({'is_error': True, 'content': 'private unknown'}), 'UNKNOWN')
        self.assertEqual(classifier.second_tool_code({'is_error': False, 'content': 'masked'}), 'SUCCESS')


if __name__ == '__main__':
    unittest.main()
