"""Private stdin/stdout bridge. Never accepts an arbitrary endpoint or prints credentials."""
import json
import sys
from urllib.parse import urlsplit

def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

def execute(payload):
    from facetlab import FacetLabClient
    from facetlab.exceptions import FacetLabError
    client = FacetLabClient(api_key=payload['key'])
    original = client.session.request
    def request(method, url, **kwargs):
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or parsed.hostname != 'qyzkdesign.com' or not parsed.path.startswith('/api/v1/product-tests'):
            raise ValueError('invalid_endpoint')
        kwargs['allow_redirects'] = False
        response = original(method, url, **kwargs)
        if response.ok and method.upper() == 'POST':
            try:
                body = response.json()
                if body.get('id'):
                    emit({'event': 'receipt', 'id': body['id'], 'status': body.get('status'),
                          'credits': body.get('credits'), 'billable': body.get('billable')})
            except (ValueError, TypeError):
                pass
        return response
    client.session.request = request
    p = client.product_tests
    action = payload['action']
    try:
        if action == 'audience':
            result = p.markets_audience(payload['market'])
        elif action == 'estimate':
            result = p.estimate(payload['spec'])
        elif action == 'create':
            result = p.create(payload['spec'], payload['images'], idempotency_key=payload['idempotency_key'])
        elif action == 'get':
            result = p.get(payload['id'], include_personas=True)
        elif action == 'cancel':
            result = p.cancel(payload['id'])
        else:
            raise ValueError('invalid_action')
        emit({'result': result})
    except FacetLabError as error:
        # Error messages may contain private provider paths; expose a code and structured data gaps only.
        details = error.details or {}
        emit({'error': str(error.code), 'details': details.get('details', {}) if isinstance(details, dict) else {}})
    finally:
        client.session.close()

if __name__ == '__main__':
    try:
        execute(json.loads(sys.stdin.buffer.read(16 * 1024 * 1024)))
    except ImportError:
        emit({'error': 'sdk_unavailable'})
    except Exception:
        emit({'error': 'transport_uncertain'})
