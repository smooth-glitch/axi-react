import sys
from fakeredis import TcpFakeServer

def main():
    port = 6379
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    print(f"FakeRedis TCP server listening on 127.0.0.1:{port}...")
    server = TcpFakeServer(('127.0.0.1', port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping FakeRedis...")
        server.shutdown()

if __name__ == '__main__':
    main()
