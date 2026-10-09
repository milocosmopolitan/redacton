"""Reject auxiliary model traffic as an actual cancellation phase."""
import ast
import pathlib
import unittest

source = ast.parse(pathlib.Path(__file__).with_name('interactive-cancellation.py').read_text())
functions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'is_main_request']
scope = {}
exec(compile(ast.Module(body=functions,type_ignores=[]),'cancellation-classifier','exec'),scope)


class CancellationClassifierTest(unittest.TestCase):
    def test_real_main_prompt_and_bash_tool_are_both_required(self):
        request={'model':'claude-sonnet-4-6','tools':[{'name':'Bash'}], 'messages':[{'role':'user','content':[{'type':'text','text':'Run the supplied synthetic tool once.'}]}]}
        self.assertTrue(scope['is_main_request'](request))
        for patch in [{'tools':[]},{'model':'claude-haiku-4-5'},{'messages':[{'role':'user','content':'Summarize this session title.'}]}]:
            self.assertFalse(scope['is_main_request']({**request,**patch}))
        self.assertFalse(scope['is_main_request']({**request,'tools':[]},True))
        self.assertTrue(scope['is_main_request']({**request,'messages':[]},True))


if __name__=='__main__':
    unittest.main()
