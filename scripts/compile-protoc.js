const fs = require('fs');
const {execSync} = require('child_process');

const supportedProtocols = ['v1alpha', 'v1'];

async function main() {
  for (const protocol of supportedProtocols) {
    if (fs.existsSync(`./src/reflection_providers/${protocol}`)) {
      fs.rmdirSync(`./src/reflection_providers/${protocol}`, {recursive: true});
    }

    fs.mkdirSync(`./src/reflection_providers/${protocol}`);

    console.log(
      `Compiling protocol buffers and building services + clients for protocol: ${protocol}...\n`
    );

    const command = [
      'grpc_tools_node_protoc',
      `--js_out=import_style=commonjs,binary:./src/reflection_providers/${protocol}`,
      `--grpc_out=grpc_js:./src/reflection_providers/${protocol}`,
      `--ts_out=grpc_js:./src/reflection_providers/${protocol}`,
      '--plugin=protoc-gen-ts=./node_modules/.bin/protoc-gen-ts',
      `-I ./static/grpc/reflection/${protocol}`,
      'reflection.proto',
    ].join(' ');

    execSync(command, {stdio: 'inherit'});

    console.log('Compilation done for', protocol, '\n');
  }

  console.log('Protocol buffers compilation completed.');
}

main().catch(err => {
  console.error('Error during protocol buffers compilation:');

  throw err;
});
