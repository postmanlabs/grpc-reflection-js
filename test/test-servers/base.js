function createServer({apiVersion = 'v1'} = {}) {
  const grpc = require('@postman/grpc-js');

  // eslint-disable-next-line node/no-extraneous-require
  const protoLoader = require('@postman/proto-loader');
  const path = require('path');
  const fs = require('fs');
  const descriptor = require('google-protobuf/google/protobuf/descriptor_pb');

  const PROTO_DIR = path.join(__dirname, '../fixtures', apiVersion);
  const WIDGETS_PROTO_PATH = path.join(PROTO_DIR, 'widgets.proto');
  const REFLECTION_PROTO_PATH = path.join(
    __dirname,
    '../../static/grpc/reflection',
    apiVersion,
    'reflection.proto'
  );
  const DESCRIPTOR_SET_PATH = path.join(
    PROTO_DIR,
    'server_descriptor.protoset'
  );

  let fileDescriptorProtos = [];

  const protosByFilename = new Map();
  const filenameBySymbol = new Map();

  const serviceNames = [];

  let server, boundPort;

  async function start(port = 0) {
    if (server) return Promise.resolve({server, port: boundPort, shutdown});

    const descriptorSetBytes = fs.readFileSync(DESCRIPTOR_SET_PATH);
    const fileDescriptorSet =
      descriptor.FileDescriptorSet.deserializeBinary(descriptorSetBytes);
    fileDescriptorProtos = fileDescriptorSet.getFileList();

    if (!fileDescriptorProtos || fileDescriptorProtos.length === 0) {
      throw new Error('Descriptor set is empty or failed to parse.');
    }

    fileDescriptorProtos.forEach(proto => {
      const filename = proto.getName();
      if (!filename) return;

      protosByFilename.set(filename, proto);

      const packageName = proto.getPackage();

      function buildSymbolName(baseName) {
        return packageName ? `${packageName}.${baseName}` : baseName;
      }

      proto.getMessageTypeList().forEach(messageType => {
        const fqMessageName = buildSymbolName(messageType.getName());
        filenameBySymbol.set(fqMessageName, filename);
      });

      proto.getEnumTypeList().forEach(enumType => {
        const fqEnumName = buildSymbolName(enumType.getName());
        filenameBySymbol.set(fqEnumName, filename);
      });

      proto.getServiceList().forEach(service => {
        const fqServiceName = buildSymbolName(service.getName());
        filenameBySymbol.set(fqServiceName, filename);
        serviceNames.push(fqServiceName);
      });
    });

    const packageDefinitionOptions = {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR],
    };
    const widgetsPackageDefinition = protoLoader.loadSync(
      WIDGETS_PROTO_PATH,
      packageDefinitionOptions
    );
    const widgetsProto = grpc.loadPackageDefinition(widgetsPackageDefinition)
      .widgets.v1;

    const reflectionPackageDefinition = protoLoader.loadSync(
      REFLECTION_PROTO_PATH,
      packageDefinitionOptions
    );

    const reflectionProto = grpc.loadPackageDefinition(
      reflectionPackageDefinition
    ).grpc.reflection[apiVersion];

    const widgetServiceImpl = {
      listWidgets: () => {},
      createWidget: () => {},
    };

    function getDependenciesRecursive(
      filename,
      protosByFilenameMap,
      visited = new Set()
    ) {
      if (visited.has(filename)) {
        return [];
      }
      visited.add(filename);

      const proto = protosByFilenameMap.get(filename);
      if (!proto) {
        return [];
      }

      const directDependencies = proto.getDependencyList();
      const allDependencies = [...directDependencies];

      directDependencies.forEach(depFilename => {
        const transitiveDeps = getDependenciesRecursive(
          depFilename,
          protosByFilenameMap,
          visited
        );
        transitiveDeps.forEach(transitiveDep => {
          if (!allDependencies.includes(transitiveDep)) {
            allDependencies.push(transitiveDep);
          }
        });
      });

      const finalDeps = allDependencies.filter(dep => dep !== filename);

      return finalDeps;
    }

    const reflectionServiceImpl = {
      serverReflectionInfo: call => {
        call.on('data', request => {
          const responseObject = {
            valid_host: request.host,
            original_request: request,

            list_services_response: null,
            file_descriptor_response: null,
            error_response: null,
          };

          try {
            const messageRequestCase = request.message_request;

            if (messageRequestCase === 'list_services') {
              const listResponseObj = {service: []};
              serviceNames.forEach(name => {
                listResponseObj.service.push({name: name});
              });
              responseObject.list_services_response = listResponseObj;
            } else if (messageRequestCase === 'file_by_filename') {
              const filename = request.file_by_filename;
              const targetProto = protosByFilename.get(filename);

              if (!targetProto) {
                responseObject.error_response = {
                  error_code: grpc.status.NOT_FOUND,
                  error_message: `File not found: ${filename}`,
                };
              } else {
                const dependencies = getDependenciesRecursive(
                  filename,
                  protosByFilename
                );
                const protosToSend = [targetProto];

                dependencies.forEach(depFilename => {
                  const depProto = protosByFilename.get(depFilename);
                  if (depProto) {
                    protosToSend.push(depProto);
                  }
                });

                const fileDescriptorResponseObj = {file_descriptor_proto: []};
                protosToSend.forEach(proto => {
                  fileDescriptorResponseObj.file_descriptor_proto.push(
                    proto.serializeBinary()
                  );
                });
                responseObject.file_descriptor_response =
                  fileDescriptorResponseObj;
              }
            } else if (messageRequestCase === 'file_containing_symbol') {
              const symbol = request.file_containing_symbol;
              const filename = filenameBySymbol.get(symbol);

              if (!filename) {
                responseObject.error_response = {
                  error_code: grpc.status.NOT_FOUND,
                  error_message: `Symbol not found: ${symbol}`,
                };
              } else {
                const targetProto = protosByFilename.get(filename);
                if (!targetProto) {
                  throw new Error(
                    `Internal error: Symbol '${symbol}' maps to filename '${filename}' but proto not found.`
                  );
                }
                const dependencies = getDependenciesRecursive(
                  filename,
                  protosByFilename
                );
                const protosToSend = [targetProto];
                dependencies.forEach(depFilename => {
                  const depProto = protosByFilename.get(depFilename);
                  if (depProto) protosToSend.push(depProto);
                });

                const fileDescriptorResponseObj = {file_descriptor_proto: []};
                protosToSend.forEach(proto => {
                  fileDescriptorResponseObj.file_descriptor_proto.push(
                    proto.serializeBinary()
                  );
                });
                responseObject.file_descriptor_response =
                  fileDescriptorResponseObj;
              }
            } else {
              responseObject.error_response = {
                error_code: grpc.status.UNIMPLEMENTED,
                error_message: `Request type '${messageRequestCase}' not implemented`,
              };
            }

            call.write(responseObject);
          } catch (error) {
            const errorRespWrapper = {
              valid_host: request.host,
              original_request: request,
              error_response: {
                error_code: grpc.status.INTERNAL,
                error_message: `Error processing reflection request: ${error.message}`,
              },
            };
            call.write(errorRespWrapper);
          }
        });

        call.on('end', () => {
          call.end();
        });
      },
    };

    const grpcServer = new grpc.Server();

    grpcServer.addService(
      widgetsProto.WidgetService.service,
      widgetServiceImpl
    );
    grpcServer.addService(
      reflectionProto.ServerReflection.service,
      reflectionServiceImpl
    );

    return new Promise((resolve, reject) => {
      grpcServer.bindAsync(
        `0.0.0.0:${port}`,
        grpc.ServerCredentials.createInsecure(),
        (err, receivedPort) => {
          if (err) return reject(err);
          grpcServer.start();
          server = grpcServer;
          boundPort = receivedPort;
          resolve({server: grpcServer, port: boundPort, shutdown});
        }
      );
    });
  }

  async function shutdown() {
    if (!server) return Promise.resolve();

    return new Promise(resolve => {
      if (!server) return resolve();
      server.tryShutdown(err => {
        if (err) server.forceShutdown();
        resolve();
      });
    });
  }

  return {start, shutdown};
}

module.exports = createServer;
