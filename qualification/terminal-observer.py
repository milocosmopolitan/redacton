"""Reply to terminal queries at their parsed position, including split reads."""
import pyte


def make_observer(columns, rows, write):
    query = ['']

    class Screen(pyte.Screen):
        def write_process_input(self, data):
            write(data.encode('ascii'))

        def report_device_attributes(self, mode=0, **kwargs):
            if mode == 0 and not kwargs.get('private', False):
                self.write_process_input('\x1b[>0;95;0c' if query[0].startswith('\x1b[>') else '\x1b[?1;2c')

    screen = Screen(columns, rows)
    stream = pyte.Stream(screen)

    class Observer:
        def feed(self, data):
            # pyte dispatches the query before later cursor movement in this read.
            for character in data:
                if character == '\x1b':
                    query[0] = character
                elif query[0]:
                    query[0] = (query[0] + character)[-32:]
                stream.feed(character)
                if query[0] and len(query[0]) > 2 and '@' <= character <= '~':
                    query[0] = ''

    return screen, Observer()
