// Test script acting as Bob over native WebSocket to test live interaction with Alice
const ws = new WebSocket('ws://localhost:8080');

ws.addEventListener('open', () => {
  console.log('Bob WebSocket opened, sending handshake...');
  ws.send(JSON.stringify({ username: 'bob', token: 'bob-tok', armSessionId: 'bob-sess' }));
});

ws.addEventListener('message', (ev) => {
  let msg;
  try {
    msg = JSON.parse(ev.data);
  } catch {
    msg = { type: '__raw__', text: ev.data };
  }
  console.log('Bob received:', msg.type, JSON.stringify(msg));

  if (msg.type === 'welcome') {
    console.log('Bob authenticated! Waiting 1s then sending DM to alice...');
    setTimeout(() => {
      console.log('Bob sending DM to alice...');
      ws.send('/msg alice Hello Alice from Bob live!');
    }, 1000);
  }

  if (msg.type === 'private') {
    console.log('Bob got DM reply from:', msg.from, 'text:', msg.text);
  }

  if (msg.type === 'dm_read') {
    console.log('Bob saw Alice read the message! from:', msg.from);
  }
});

setTimeout(() => {
  console.log('Bob disconnecting...');
  ws.close();
  process.exit(0);
}, 6000);
