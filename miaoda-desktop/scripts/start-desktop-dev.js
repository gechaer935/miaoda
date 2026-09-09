const http = require('http');
const { spawn } = require('child_process');

const PORT = 5180;

function inspectPort() {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: 'localhost', port: PORT, path: '/', timeout: 1500 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (body.length < 128 * 1024) body += chunk;
      });
      response.on('end', () => {
        const isMiaodaVite = response.statusCode === 200
          && body.includes('/@vite/client')
          && body.includes('/src/main.tsx');
        resolve(isMiaodaVite ? 'miaoda-vite' : 'occupied');
      });
    });

    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', (error) => {
      if (error.code === 'ECONNREFUSED') resolve('free');
      else reject(error);
    });
  });
}

function runNpm(script) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npm, ['run', script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('error', (error) => {
    console.error(`[desktop] Failed to start ${script}:`, error.message);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

async function main() {
  let portState;
  try {
    portState = await inspectPort();
  } catch (error) {
    console.error(`[desktop] Unable to inspect port ${PORT}:`, error.message);
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--probe')) {
    console.log(portState);
    return;
  }

  if (portState === 'occupied') {
    console.error(`[desktop] Port ${PORT} is occupied by another service. Stop it before starting Miaoda.`);
    process.exitCode = 1;
    return;
  }

  if (portState === 'miaoda-vite') {
    console.log(`[desktop] Reusing the existing Miaoda Vite server on port ${PORT}.`);
    runNpm('electron:dev');
    return;
  }

  console.log(`[desktop] Port ${PORT} is free; starting Vite and Electron.`);
  runNpm('app:dev:fresh');
}

void main();
