/* eslint-disable no-undef */
import {
  credentials,
  ServiceError,
  status as GrpcStatus,
} from '@postman/grpc-js';
import {Client} from '../src/client';
import {assert} from 'chai';
import * as sinon from 'sinon';

import * as services_v1alpha from '../src/generated/v1alpha/reflection_grpc_pb';
import {
  ServerReflectionResponse as ServerReflectionResponse_v1alpha,
  ListServiceResponse as ListServiceResponse_v1alpha,
  ServiceResponse as ServiceResponse_v1alpha,
  FileDescriptorResponse as FileDescriptorResponse_v1alpha,
} from '../src/generated/v1alpha/reflection_pb';
import * as services_v1 from '../src/generated/v1/reflection_grpc_pb';
import {
  ServerReflectionResponse as ServerReflectionResponse_v1,
  ListServiceResponse as ListServiceResponse_v1,
  ServiceResponse as ServiceResponse_v1,
  FileDescriptorResponse as FileDescriptorResponse_v1,
} from '../src/generated/v1/reflection_pb';

const v1TestServices = [
  'grpc.reflection.v1.ServerReflection',
  'phone.Messenger',
];

const v1alphaTestServices = [
  'grpc.reflection.v1alpha.ServerReflection',
  'phone.Messenger',
];

const phoneProtoBytes = Buffer.from([
  10,
  11,
  112,
  104,
  111,
  110,
  101,
  46,
  112,
  114,
  111,
  116,
  111,
  18,
  5,
  112,
  104,
  111,
  110,
  101,
  26,
  13,
  99,
  111,
  110,
  116,
  97,
  99,
  116,
  46,
  112,
  114,
  111,
  116,
  111,
  34,
  97,
  10,
  11,
  84,
  101,
  120,
  116,
  82,
  101,
  113,
  117,
  101,
  115,
  116,
  18,
  14,
  10,
  2,
  105,
  100,
  24,
  1,
  32,
  1,
  40,
  9,
  82,
  2,
  105,
  100,
  18,
  24,
  10,
  7,
  109,
  101,
  115,
  115,
  97,
  103,
  101,
  24,
  2,
  32,
  1,
  40,
  9,
  82,
  7,
  109,
  101,
  115,
  115,
  97,
  103,
  101,
  18,
  40,
  10,
  7,
  99,
  111,
  110,
  116,
  97,
  99,
  116,
  24,
  3,
  32,
  1,
  40,
  11,
  50,
  14,
  46,
  112,
  104,
  111,
  110,
  101,
  46,
  67,
  111,
  110,
  116,
  97,
  99,
  116,
  82,
  7,
  99,
  111,
  110,
  116,
  97,
  99,
  116,
  34,
  40,
  10,
  12,
  84,
  101,
  120,
  116,
  82,
  101,
  115,
  112,
  111,
  110,
  115,
  101,
  18,
  24,
  10,
  7,
  115,
  117,
  99,
  99,
  101,
  115,
  115,
  24,
  1,
  32,
  1,
  40,
  8,
  82,
  7,
  115,
  117,
  99,
  99,
  101,
  115,
  115,
  50,
  63,
  10,
  9,
  77,
  101,
  115,
  115,
  101,
  110,
  103,
  101,
  114,
  18,
  50,
  10,
  7,
  77,
  101,
  115,
  115,
  97,
  103,
  101,
  18,
  18,
  46,
  112,
  104,
  111,
  110,
  101,
  46,
  84,
  101,
  120,
  116,
  82,
  101,
  113,
  117,
  101,
  115,
  116,
  26,
  19,
  46,
  112,
  104,
  111,
  110,
  101,
  46,
  84,
  101,
  120,
  116,
  82,
  101,
  115,
  112,
  111,
  110,
  115,
  101,
  98,
  6,
  112,
  114,
  111,
  116,
  111,
  51,
]);
const contactProtoBytes = Buffer.from([
  10,
  13,
  99,
  111,
  110,
  116,
  97,
  99,
  116,
  46,
  112,
  114,
  111,
  116,
  111,
  18,
  5,
  112,
  104,
  111,
  110,
  101,
  34,
  53,
  10,
  7,
  67,
  111,
  110,
  116,
  97,
  99,
  116,
  18,
  18,
  10,
  4,
  110,
  97,
  109,
  101,
  24,
  1,
  32,
  1,
  40,
  9,
  82,
  4,
  110,
  97,
  109,
  101,
  18,
  22,
  10,
  6,
  110,
  117,
  109,
  98,
  101,
  114,
  24,
  2,
  32,
  1,
  40,
  9,
  82,
  6,
  110,
  117,
  109,
  98,
  101,
  114,
  98,
  6,
  112,
  114,
  111,
  116,
  111,
  51,
]);

const mockReflectionStream = (
  options: {
    responseMessage?:
      | ServerReflectionResponse_v1
      | ServerReflectionResponse_v1alpha
      | null;
    error?: ServiceError | null;
  } = {}
) => {
  const {responseMessage, error} = options;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dataListener: ((response: any) => void) | null = null;
  let errorListener: ((error: ServiceError) => void) | null = null;
  let endListener: (() => void) | null = null;

  const stream = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on: (event: string, listener: (...args: any[]) => void) => {
      if (event === 'data') {
        dataListener = listener;
      } else if (event === 'error') {
        errorListener = listener as (error: ServiceError) => void; // Cast needed
      } else if (event === 'end') {
        endListener = listener;
      }
    },
    write: sinon.stub(),

    end: sinon.stub().callsFake(() => {
      setTimeout(() => {
        if (error && errorListener) {
          errorListener(error);
        } else if (responseMessage && dataListener) {
          dataListener(responseMessage);
        }

        if (endListener) {
          endListener();
        }
      }, 0);
    }),
  };
  return stream;
};

const unimplementedCall = mockReflectionStream({
  error: Object.assign(new Error('Method not found') as ServiceError, {
    code: GrpcStatus.UNIMPLEMENTED,
  }),
});

// V1 Mocks
const v1_listServicesCall = (() => {
  const res = new ServerReflectionResponse_v1();
  const listRes = new ListServiceResponse_v1();
  listRes.setServiceList(
    v1TestServices.map(name => new ServiceResponse_v1().setName(name))
  );
  res.setListServicesResponse(listRes);
  return mockReflectionStream({responseMessage: res});
})();

const v1_phoneProtoCall = (() => {
  const res = new ServerReflectionResponse_v1();
  const fdRes = new FileDescriptorResponse_v1();
  fdRes.addFileDescriptorProto(phoneProtoBytes);
  res.setFileDescriptorResponse(fdRes);
  return mockReflectionStream({responseMessage: res});
})();

const v1_contactProtoCall = (() => {
  const res = new ServerReflectionResponse_v1();
  const fdRes = new FileDescriptorResponse_v1();
  fdRes.addFileDescriptorProto(contactProtoBytes);
  res.setFileDescriptorResponse(fdRes);
  return mockReflectionStream({responseMessage: res});
})();

// V1Alpha Mocks
const v1alpha_listServicesCall = (() => {
  const res = new ServerReflectionResponse_v1alpha();
  const listRes = new ListServiceResponse_v1alpha();
  listRes.setServiceList(
    v1alphaTestServices.map(name => new ServiceResponse_v1alpha().setName(name))
  );
  res.setListServicesResponse(listRes);
  return mockReflectionStream({responseMessage: res});
})();

const v1alpha_phoneProtoCall = (() => {
  const res = new ServerReflectionResponse_v1alpha();
  const fdRes = new FileDescriptorResponse_v1alpha();
  fdRes.addFileDescriptorProto(phoneProtoBytes);
  res.setFileDescriptorResponse(fdRes);
  return mockReflectionStream({responseMessage: res});
})();

const v1alpha_contactProtoCall = (() => {
  const res = new ServerReflectionResponse_v1alpha();
  const fdRes = new FileDescriptorResponse_v1alpha();
  fdRes.addFileDescriptorProto(contactProtoBytes);
  res.setFileDescriptorResponse(fdRes);
  return mockReflectionStream({responseMessage: res});
})();

describe('gRPC Reflection Client', () => {
  let sandbox: sinon.SinonSandbox;
  let clientV1Stub: sinon.SinonStub;
  let clientV1AlphaStub: sinon.SinonStub;
  let reflectionClient: Client;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clientV1Stub = sandbox.stub(
      services_v1.ServerReflectionClient.prototype,
      'serverReflectionInfo'
    );
    clientV1AlphaStub = sandbox.stub(
      services_v1alpha.ServerReflectionClient.prototype,
      'serverReflectionInfo'
    );
    reflectionClient = new Client(
      'localhost:4770',
      credentials.createInsecure()
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Client - v1alpha Protocol', () => {
    beforeEach(() => {
      // assuming v1 probe fails, v1alpha succeeds
      clientV1Stub.returns(unimplementedCall);
      clientV1AlphaStub.returns(v1alpha_listServicesCall);
    });

    it('listServices: should return services', async () => {
      const services = await reflectionClient.listServices();

      // assert detected version is v1alpha
      assert.strictEqual(reflectionClient['detectedVersion'], 'v1alpha');
      assert.sameMembers(services, v1alphaTestServices);
      sinon.assert.calledOnce(clientV1Stub);
      sinon.assert.calledOnce(clientV1AlphaStub);
    });

    it('fileContainingSymbol: should return Root', async () => {
      clientV1AlphaStub.onSecondCall().returns(v1alpha_phoneProtoCall);
      clientV1AlphaStub.onThirdCall().returns(v1alpha_contactProtoCall);

      const root = await reflectionClient.fileContainingSymbol(
        'phone.Messenger'
      );

      assert.strictEqual(reflectionClient['detectedVersion'], 'v1alpha');
      assert.sameDeepMembers(root.files, ['contact.proto', 'phone.proto']);
      sinon.assert.calledOnce(clientV1Stub);
      sinon.assert.callCount(clientV1AlphaStub, 3);
    });

    it('fileByFilename: should return Root', async () => {
      clientV1AlphaStub.onSecondCall().returns(v1alpha_contactProtoCall);

      const root = await reflectionClient.fileByFilename('contact.proto');

      assert.deepEqual(root.files, ['contact.proto']);
      assert.strictEqual(reflectionClient['detectedVersion'], 'v1alpha');
      sinon.assert.calledOnce(clientV1Stub);
      sinon.assert.calledTwice(clientV1AlphaStub);
    });
  });

  describe('Client - v1 Protocol', () => {
    beforeEach(() => {
      clientV1Stub.returns(v1_listServicesCall);
      clientV1AlphaStub.returns(unimplementedCall); // v1alpha calls will fail
    });

    it('listServices: should return services', async () => {
      const services = await reflectionClient.listServices();
      // ensure activation completed and detected v1
      assert.strictEqual(reflectionClient['detectedVersion'], 'v1');
      // assert only v1 services are returned
      assert.sameMembers(services, v1TestServices);

      // assert that only v1 client was called only once
      sinon.assert.calledOnce(clientV1Stub);
      sinon.assert.notCalled(clientV1AlphaStub);
    });

    it('fileContainingSymbol: should return Root', async () => {
      clientV1Stub.onSecondCall().returns(v1_phoneProtoCall);
      clientV1Stub.onThirdCall().returns(v1_contactProtoCall);

      const root = await reflectionClient.fileContainingSymbol(
        'phone.Messenger'
      );

      assert.strictEqual(reflectionClient['detectedVersion'], 'v1');
      assert.sameDeepMembers(root.files, ['contact.proto', 'phone.proto']);
      sinon.assert.callCount(clientV1Stub, 3);
      sinon.assert.notCalled(clientV1AlphaStub);
    });

    it('fileByFilename: should return Root', async () => {
      clientV1Stub.onSecondCall().returns(v1_contactProtoCall);

      const root = await reflectionClient.fileByFilename('contact.proto');
      assert.strictEqual(reflectionClient['detectedVersion'], 'v1');
      assert.deepEqual(root.files, ['contact.proto']);
      sinon.assert.calledTwice(clientV1Stub);
      sinon.assert.notCalled(clientV1AlphaStub);
    });
  });
});
