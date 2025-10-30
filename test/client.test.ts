import {describe, before, after, it} from 'mocha';
import {Client} from '../src/client';
import {credentials} from '@postman/grpc-js';
// eslint-disable-next-line node/no-unpublished-import
import {assert} from 'chai';
import * as sinon from 'sinon';
import {
  ServerReflectionResponse,
  ListServiceResponse,
  ServiceResponse,
  FileDescriptorResponse,
} from '../src/reflection_providers/v1/reflection_pb';

describe('server reflection tests', () => {
  const reflectionMethodsToTest = [
    {name: 'v1', port: 4771},
    {name: 'v1alpha', port: 4772},
  ];

  let mockV1Server: {port: number; shutdown: () => Promise<void>};
  let mockV1AlphaServer: {port: number; shutdown: () => Promise<void>};

  before(async () => {
    const v1ServerImport = await import('./test-servers/v1-server'),
      v1AlphaServerImport = await import('./test-servers/v1alpha-server');

    mockV1Server = await v1ServerImport.start(4771);
    mockV1AlphaServer = await v1AlphaServerImport.start(4772);
  });

  after(async () => {
    await mockV1Server.shutdown();
    await mockV1AlphaServer.shutdown();
  });

  describe('listServices', async () => {
    for (const version of reflectionMethodsToTest) {
      it(`should return services: ${version.name}`, async () => {
        const reflectionClient = new Client(
          `0.0.0.0:${version.port}`,
          credentials.createInsecure()
        );

        await reflectionClient.initialize();

        const grpcCall = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          on: function (_event: string, listener: (...args: any[]) => void) {
            const res = new ServerReflectionResponse();

            const service1 = new ServiceResponse();
            service1.setName('grpc.reflection.v1alpha.ServerReflection');
            const service2 = new ServiceResponse();
            service2.setName('phone.Messenger');
            const serviceList = [service1, service2];

            const listService = new ListServiceResponse();
            listService.setServiceList(serviceList);
            res.setListServicesResponse(listService);

            listener(res);
          },
          write: function () {},
          end: function () {},
        };

        const mock = sinon.mock(reflectionClient.grpcClient);
        mock.expects('serverReflectionInfo').once().returns(grpcCall);

        const expectedServices: string[] = ['phone.Messenger'];
        assert.sameMembers(
          await reflectionClient.listServices(),
          expectedServices
        );
      });
    }
  });

  describe('fileContainingSymbol', () => {
    for (const version of reflectionMethodsToTest) {
      it(`should return Root: ${version.name}`, async () => {
        const reflectionClient = new Client(
          `0.0.0.0:${version.port}`,
          credentials.createInsecure()
        );

        await reflectionClient.initialize();

        const grpcCallPhone = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          on: function (_event: string, listener: (...args: any[]) => void) {
            if (_event === 'error') {
              return;
            }

            const res = new ServerReflectionResponse();
            const fileDescriptorResponse = new FileDescriptorResponse();
            // eslint-disable-next-line prettier/prettier
            const protoBytes = Buffer.from([10,11,112,104,111,110,101,46,112,114,111,116,111,18,5,112,104,111,110,101,26,13,99,111,110,116,97,99,116,46,112,114,111,116,111,34,97,10,11,84,101,120,116,82,101,113,117,101,115,116,18,14,10,2,105,100,24,1,32,1,40,9,82,2,105,100,18,24,10,7,109,101,115,115,97,103,101,24,2,32,1,40,9,82,7,109,101,115,115,97,103,101,18,40,10,7,99,111,110,116,97,99,116,24,3,32,1,40,11,50,14,46,112,104,111,110,101,46,67,111,110,116,97,99,116,82,7,99,111,110,116,97,99,116,34,40,10,12,84,101,120,116,82,101,115,112,111,110,115,101,18,24,10,7,115,117,99,99,101,115,115,24,1,32,1,40,8,82,7,115,117,99,99,101,115,115,50,63,10,9,77,101,115,115,101,110,103,101,114,18,50,10,7,77,101,115,115,97,103,101,18,18,46,112,104,111,110,101,46,84,101,120,116,82,101,113,117,101,115,116,26,19,46,112,104,111,110,101,46,84,101,120,116,82,101,115,112,111,110,115,101,98,6,112,114,111,116,111,51]);
            fileDescriptorResponse.addFileDescriptorProto(protoBytes);
            res.setFileDescriptorResponse(fileDescriptorResponse);

            listener(res);
          },
          write: function () {},
          end: function () {},
        };

        const grpcCallContact = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          on: function (_event: string, listener: (...args: any[]) => void) {
            if (_event === 'error') {
              return;
            }

            const res = new ServerReflectionResponse();
            const fileDescriptorResponse = new FileDescriptorResponse();
            // eslint-disable-next-line prettier/prettier
            const protoBytes = Buffer.from([10,13,99,111,110,116,97,99,116,46,112,114,111,116,111,18,5,112,104,111,110,101,34,53,10,7,67,111,110,116,97,99,116,18,18,10,4,110,97,109,101,24,1,32,1,40,9,82,4,110,97,109,101,18,22,10,6,110,117,109,98,101,114,24,2,32,1,40,9,82,6,110,117,109,98,101,114,98,6,112,114,111,116,111,51]);
            fileDescriptorResponse.addFileDescriptorProto(protoBytes);
            res.setFileDescriptorResponse(fileDescriptorResponse);

            listener(res);
          },
          write: function () {},
          end: function () {},
        };

        const mock = sinon.mock(reflectionClient.grpcClient);
        mock.expects('serverReflectionInfo').once().returns(grpcCallPhone);
        mock.expects('serverReflectionInfo').once().returns(grpcCallContact);
        const root = await reflectionClient.fileContainingSymbol(
          'phone.Messenger'
        );
        assert.sameDeepMembers(root.files, ['contact.proto', 'phone.proto']);
      });
    }
  });

  describe('fileByFilename', () => {
    for (const version of reflectionMethodsToTest) {
      it(`should return Root: ${version.name}`, async () => {
        const reflectionClient = new Client(
          `0.0.0.0:${version.port}`,
          credentials.createInsecure()
        );

        await reflectionClient.initialize();

        const grpcCallContact = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          on: function (_event: string, listener: (...args: any[]) => void) {
            if (_event === 'error') {
              return;
            }
            const res = new ServerReflectionResponse();
            const fileDescriptorResponse = new FileDescriptorResponse();
            // eslint-disable-next-line prettier/prettier
            const protoBytes = Buffer.from([10,13,99,111,110,116,97,99,116,46,112,114,111,116,111,18,5,112,104,111,110,101,34,53,10,7,67,111,110,116,97,99,116,18,18,10,4,110,97,109,101,24,1,32,1,40,9,82,4,110,97,109,101,18,22,10,6,110,117,109,98,101,114,24,2,32,1,40,9,82,6,110,117,109,98,101,114,98,6,112,114,111,116,111,51]);
            fileDescriptorResponse.addFileDescriptorProto(protoBytes);
            res.setFileDescriptorResponse(fileDescriptorResponse);

            listener(res);
          },
          write: function () {},
          end: function () {},
        };

        const mock = sinon.mock(reflectionClient.grpcClient);
        mock.expects('serverReflectionInfo').once().returns(grpcCallContact);
        const root = await reflectionClient.fileByFilename('contact.proto');
        assert.deepEqual(root.files, ['contact.proto']);
      });
    }
  });
});
