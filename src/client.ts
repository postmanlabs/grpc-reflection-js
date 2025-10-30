import {
  ChannelCredentials,
  Metadata,
  ServiceError,
  status as GrpcStatus,
} from '@postman/grpc-js';
import {getDescriptorRootFromDescriptorSet} from './descriptor';
import {Root} from '@postman/protobufjs';
import {
  FileDescriptorSet,
  IFileDescriptorProto,
  FileDescriptorProto,
} from '@postman/protobufjs/ext/descriptor';
import set from 'lodash.set';

// Static type definitions with common structures across all reflection providers
import type {ServerReflectionClient} from './reflection_providers/v1alpha/reflection_grpc_pb';
import type {
  ServerReflectionRequest,
  ServerReflectionResponse,
} from './reflection_providers/v1alpha/reflection_pb';

const supportedReflectionAPIVersions = {
  v1alpha: {
    priority: 0,
    serviceName: 'grpc.reflection.v1alpha.ServerReflection',
    client: import('./reflection_providers/v1alpha/reflection_pb'),
    service: import('./reflection_providers/v1alpha/reflection_grpc_pb'),
  },
  v1: {
    priority: 1,
    serviceName: 'grpc.reflection.v1.ServerReflection',
    client: import('./reflection_providers/v1/reflection_pb'),
    service: import('./reflection_providers/v1/reflection_grpc_pb'),
  },
};

export class Client {
  metadata: Metadata;
  private fileDescriptorCache: Map<string, IFileDescriptorProto> = new Map();
  private url: string;
  private credentials: ChannelCredentials;
  private clientOptions: object | undefined;

  grpcClient: ServerReflectionClient | undefined;
  private reflectionResponseCache: ServerReflectionResponse | undefined;
  private compatibleProtocol: string | undefined;
  private CompatibleServerReflectionRequest:
    | (new (
        ...args: ConstructorParameters<typeof ServerReflectionRequest>
      ) => ServerReflectionRequest)
    | undefined;

  constructor(
    url: string,
    credentials: ChannelCredentials,
    options?: object,
    metadata?: Metadata
  ) {
    this.url = url;
    this.credentials = credentials;
    this.clientOptions = options;
    this.fileDescriptorCache = new Map();
    this.metadata = metadata || new Metadata();
  }

  private async sendReflectionRequest(
    request: ServerReflectionRequest | ServerReflectionRequest[],
    client?: ServerReflectionClient
  ): Promise<ServerReflectionResponse[]> {
    return new Promise((resolve, reject) => {
      const result: ServerReflectionResponse[] = [];

      const grpcCall = (client || this.grpcClient!).serverReflectionInfo(
        this.metadata
      );

      grpcCall.on('data', (response: ServerReflectionResponse) => {
        result.push(response);
      });

      grpcCall.on('error', (error: ServiceError) => {
        reject(error);
      });

      grpcCall.on('end', () => resolve(result));

      if (Array.isArray(request)) {
        request.forEach(req => grpcCall.write(req));
      } else {
        grpcCall.write(request);
      }

      grpcCall.end();
    });
  }

  private async evaluateSupportedServerReflectionProtocol() {
    const evaluationPromises = [];

    // Check version compatibility and initialize gRPC client based on that
    for (const version of Object.keys(supportedReflectionAPIVersions)) {
      type ReflectionCheckPromiseReturnType = {
        successful: boolean;
        priority: number;
        effect?: () => void;
        error?: ServiceError;
      };

      evaluationPromises.push(
        // eslint-disable-next-line no-async-promise-executor
        new Promise<ReflectionCheckPromiseReturnType>(async resolve => {
          const protocolConfig =
            supportedReflectionAPIVersions[
              version as keyof typeof supportedReflectionAPIVersions
            ];
          const {
            service: servicePromise,
            client: clientPromise,
          } = protocolConfig;

          const [protocolService, protocolClient] = await Promise.all([
            servicePromise,
            clientPromise,
          ]);

          const grpcClientForProtocol = new protocolService.ServerReflectionClient(
            this.url,
            this.credentials,
            this.clientOptions
          );

          const request = new protocolClient.ServerReflectionRequest();

          request.setListServices('*');

          try {
            const [reflectionResponse] = await this.sendReflectionRequest(
              request,
              grpcClientForProtocol
            );

            return resolve({
              successful: true,
              priority: protocolConfig.priority,
              effect: () => {
                this.grpcClient = grpcClientForProtocol;
                this.compatibleProtocol = version;
                this.CompatibleServerReflectionRequest =
                  protocolClient.ServerReflectionRequest;
                this.reflectionResponseCache = reflectionResponse;
              },
            });
          } catch (error) {
            return resolve({
              successful: false,
              priority: protocolConfig.priority,
              error: error as ServiceError,
            });
          }
        })
      );
    }

    const evaluationResults = await Promise.all(evaluationPromises);

    const [successfulReflectionByPriority] = evaluationResults
      .filter(res => res.successful)
      .sort((res1, res2) => res2.priority - res1.priority);

    if (!successfulReflectionByPriority) {
      const reflectionNotImplementedError = evaluationResults.find(res => {
        return res.error && res.error.code === GrpcStatus.UNIMPLEMENTED;
      });

      const resultWithServiceError = evaluationResults.find(res => {
        // Something is actually wrong with the gRPC service
        return res.error && res.error.code !== GrpcStatus.UNIMPLEMENTED;
      });

      throw (
        resultWithServiceError?.error ||
        reflectionNotImplementedError?.error ||
        new Error('No compatible reflection API found.')
      );
    }

    // Set grpc client and other properties based on highest priority successful version
    successfulReflectionByPriority.effect!();
  }

  private async initializeReflectionClient() {
    if (this.grpcClient || this.compatibleProtocol) return;

    await this.evaluateSupportedServerReflectionProtocol();
  }

  async listServices(): Promise<string[]> {
    await this.initializeReflectionClient();

    return new Promise((resolve, reject) => {
      function dataCallback(response: ServerReflectionResponse) {
        if (response.hasListServicesResponse()) {
          const services = response
            .getListServicesResponse()
            ?.getServiceList()
            .map(svc => {
              return svc.getName();
            });
          resolve(services || []);
        } else {
          reject(Error());
        }
      }

      function errorCallback(e: ServiceError) {
        reject(e);
      }

      if (this.reflectionResponseCache) {
        return dataCallback(this.reflectionResponseCache);
      }

      const request = new this.CompatibleServerReflectionRequest!();
      request.setListServices('*');

      this.sendReflectionRequest(request)
        .then(([response]) => dataCallback(response))
        .catch(errorCallback);
    });
  }

  fileContainingSymbol(symbol: string): Promise<Root> {
    return new Promise((resolve, reject) => {
      this.getFileContainingSymbol(symbol)
        .then(val => resolve(this.resolveFileDescriptorSet(val)))
        .catch(err => reject(err));
    });
  }

  fileByFilename(filename: string): Promise<Root> {
    return new Promise((resolve, reject) => {
      this.getFilesByFilenames([filename])
        .then(val => resolve(this.resolveFileDescriptorSet(val)))
        .catch(err => reject(err));
    });
  }

  private async resolveFileDescriptorSet(
    fileDescriptorProtos: Array<IFileDescriptorProto> | undefined
  ): Promise<Root> {
    const fileDescriptorMap = await this.resolveDescriptorRecursive(
      fileDescriptorProtos
    );
    const fileDescriptorSet = FileDescriptorSet.create();
    set(fileDescriptorSet, 'file', Array.from(fileDescriptorMap.values()));
    return getDescriptorRootFromDescriptorSet(fileDescriptorSet);
  }

  private async resolveDescriptorRecursive(
    fileDescriptorProtos: Array<IFileDescriptorProto> = [],
    fileDescriptorMap: Map<string, IFileDescriptorProto> = new Map()
  ): Promise<Map<string, IFileDescriptorProto>> {
    await Promise.all(
      fileDescriptorProtos.map(async fileDescriptorProto => {
        if (fileDescriptorMap.has(fileDescriptorProto.name as string)) {
          return;
        } else {
          fileDescriptorMap.set(
            fileDescriptorProto.name as string,
            fileDescriptorProto
          );
        }

        const dependencies = (fileDescriptorProto.dependency || []).filter(
          (dependency: string) => !fileDescriptorMap.has(dependency)
        );
        if (dependencies.length) {
          await this.resolveDescriptorRecursive(
            await this.getFilesByFilenames(dependencies),
            fileDescriptorMap
          );
        }
      })
    );

    return fileDescriptorMap;
  }

  private async getFileContainingSymbol(
    symbol: string
  ): Promise<Array<IFileDescriptorProto> | undefined> {
    await this.initializeReflectionClient();

    const fileDescriptorCache = this.fileDescriptorCache;
    return new Promise((resolve, reject) => {
      function dataCallback(response: ServerReflectionResponse) {
        if (response.hasFileDescriptorResponse()) {
          const fileDescriptorProtoBytes = (response
            .getFileDescriptorResponse()
            ?.getFileDescriptorProtoList() || []) as Array<Uint8Array>;

          resolve(
            fileDescriptorProtoBytes.map(descriptorByte => {
              const fileDescriptorProto = FileDescriptorProto.decode(
                descriptorByte
              ) as IFileDescriptorProto;

              fileDescriptorCache.set(
                fileDescriptorProto.name as string,
                fileDescriptorProto
              );

              return fileDescriptorProto;
            })
          );
        } else {
          reject(Error());
        }
      }

      function errorCallback(e: ServiceError) {
        reject(e);
      }

      const request = new this.CompatibleServerReflectionRequest!();
      request.setFileContainingSymbol(symbol);

      this.sendReflectionRequest(request)
        .then(([response]) => dataCallback(response))
        .catch(errorCallback);
    });
  }

  private async getFilesByFilenames(
    symbols: string[]
  ): Promise<Array<IFileDescriptorProto> | undefined> {
    await this.initializeReflectionClient();

    const result: Array<IFileDescriptorProto> = [];
    const fileDescriptorCache = this.fileDescriptorCache;
    const symbolsToFetch = symbols.filter(symbol => {
      const cached = fileDescriptorCache.get(symbol);
      if (cached) {
        result.push(cached);
        return false;
      }
      return true;
    });

    if (symbolsToFetch.length === 0) {
      return Promise.resolve(result);
    }

    return new Promise((resolve, reject) => {
      function dataCallback(response: ServerReflectionResponse) {
        if (response.hasFileDescriptorResponse()) {
          response
            .getFileDescriptorResponse()
            ?.getFileDescriptorProtoList()
            ?.forEach(descriptorByte => {
              if (descriptorByte instanceof Uint8Array) {
                const fileDescriptorProto = FileDescriptorProto.decode(
                  descriptorByte
                ) as IFileDescriptorProto;

                fileDescriptorCache.set(
                  fileDescriptorProto.name as string,
                  fileDescriptorProto
                );

                result.push(fileDescriptorProto);
              }
            });
        } else if (response.hasErrorResponse()) {
          const err = response.getErrorResponse();
          reject(
            new Error(
              `Error: ${err?.getErrorCode()}: ${err?.getErrorMessage()}`
            )
          );
        } else {
          reject(Error());
        }
      }

      function errorCallback(e: ServiceError) {
        reject(e);
      }

      const requests = symbolsToFetch.map(symbol => {
        const request = new this.CompatibleServerReflectionRequest!();
        return request.setFileByFilename(symbol);
      });

      this.sendReflectionRequest(requests)
        .then(responses => {
          for (const dataBit of responses) dataCallback(dataBit);
          resolve(result);
        })
        .catch(errorCallback);
    });
  }
}
