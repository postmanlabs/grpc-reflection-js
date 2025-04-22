import {
  ChannelCredentials,
  Metadata,
  ServiceError,
  status as GrpcStatus,
  ClientDuplexStream,
} from '@postman/grpc-js';
import {Root} from '@postman/protobufjs';
import {
  FileDescriptorSet,
  IFileDescriptorProto,
  FileDescriptorProto,
} from '@postman/protobufjs/ext/descriptor';
import set from 'lodash.set';

import {getDescriptorRootFromDescriptorSet} from './descriptor';
import * as services_v1alpha from './generated/v1alpha/reflection_grpc_pb';
import {
  ServerReflectionRequest as ServerReflectionRequest_v1alpha,
  ServerReflectionResponse as ServerReflectionResponse_v1alpha,
} from './generated/v1alpha/reflection_pb';
import * as services_v1 from './generated/v1/reflection_grpc_pb';
import {
  ServerReflectionRequest as ServerReflectionRequest_v1,
  ServerReflectionResponse as ServerReflectionResponse_v1,
} from './generated/v1/reflection_pb';

type ReflectionClient =
  | services_v1.ServerReflectionClient
  | services_v1alpha.ServerReflectionClient;
type ReflectionRequest =
  | ServerReflectionRequest_v1
  | ServerReflectionRequest_v1alpha;
type ReflectionResponse =
  | ServerReflectionResponse_v1
  | ServerReflectionResponse_v1alpha;
type ReflectionVersion = 'v1' | 'v1alpha';

type ServerReflectionRequestClass =
  | typeof ServerReflectionRequest_v1
  | typeof ServerReflectionRequest_v1alpha;

export class Client {
  private url: string;
  private credentials: ChannelCredentials;
  private clientOptions?: object;
  metadata: Metadata;
  private fileDescriptorCache: Map<string, IFileDescriptorProto> = new Map();
  private reflectionOptions?: {
    useExperimentalMapFieldDecoding?: boolean;
  };

  private serviceListCache: string[] | null = null;
  private detectedVersion: ReflectionVersion | null = null;
  private activeGrpcClient: ReflectionClient | null = null;

  constructor(
    url: string,
    credentials: ChannelCredentials,
    options?: object,
    metadata?: Metadata,
    reflectionOptions?: Client['reflectionOptions']
  ) {
    this.url = url;
    this.credentials = credentials;
    this.clientOptions = options;
    this.fileDescriptorCache = new Map();
    this.metadata = metadata || new Metadata();
    this.reflectionOptions = reflectionOptions;
  }

  /**
   * Activates the gRPC reflection client by detecting the supported reflection protocol version.
   *
   * This method attempts to establish a connection with the gRPC server and determine whether
   * the server supports the v1 or v1alpha reflection protocol. It performs a lightweight request
   * to verify protocol support
   *
   * @returns {Promise<ReflectionVersion>} A promise that resolves to the detected reflection protocol version ('v1' or 'v1alpha').
   */
  private async activateClient(): Promise<ReflectionVersion> {
    if (this.detectedVersion && this.activeGrpcClient)
      return this.detectedVersion;

    this.activeGrpcClient = null;
    this.detectedVersion = null;
    this.serviceListCache = null;

    try {
      const clientV1 = new services_v1.ServerReflectionClient(
        this.url,
        this.credentials,
        this.clientOptions
      );
      try {
        await this.checkProtocolSupport(clientV1, ServerReflectionRequest_v1);
        this.activeGrpcClient = clientV1;
        this.detectedVersion = 'v1';
        return 'v1';
      } catch (error) {
        // if UNIMPLEMENTED error, fallback to v1alpha else throw error
        if ((error as ServiceError).code !== GrpcStatus.UNIMPLEMENTED)
          throw error;
      }
      const clientV1alpha = new services_v1alpha.ServerReflectionClient(
        this.url,
        this.credentials,
        this.clientOptions
      );
      await this.checkProtocolSupport(
        clientV1alpha,
        ServerReflectionRequest_v1alpha
      );
      this.activeGrpcClient = clientV1alpha;
      this.detectedVersion = 'v1alpha';
      return 'v1alpha';
    } catch (error) {
      this.activeGrpcClient = null;
      this.detectedVersion = null;
      this.serviceListCache = null;
      throw error;
    }
  }

  /**
    calls listServices method with a given client
    and caches its response
  */
  private checkProtocolSupport(
    client: ReflectionClient,
    ReqClass: ServerReflectionRequestClass
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = new ReqClass();
      request.setListServices('*');
      let grpcCall: ClientDuplexStream<
        ReflectionRequest,
        ReflectionResponse
      > | null = null;
      const completeCall = (error?: Error) => {
        if (error) reject(error);
        else resolve();
      };
      try {
        grpcCall = client.serverReflectionInfo(this.metadata);

        grpcCall.on('data', (res: ReflectionResponse) => {
          // attempt to cache service list if received during probe
          if (res.hasListServicesResponse()) {
            const listResponse = res.getListServicesResponse();
            const currentServices =
              listResponse?.getServiceList().map(svc => svc.getName()) || [];
            this.serviceListCache = currentServices;
          }
        });

        grpcCall.on('error', e => completeCall(e));
        grpcCall.on('end', () => completeCall());
        grpcCall.write(request);
        grpcCall.end();
      } catch (error) {
        completeCall(error as Error);
      }
    });
  }

  /**
   * Executes a gRPC reflection request and handles the response.
   *
   * @param {ReflectionRequest | ReflectionRequest[]} request - The request object(s) to send.
   * @param {(response: ReflectionResponse) => void} dataCallback - Callback function to handle each response.
   * @param {TResultAccumulator} resultAccumulator - An accumulator for the results.
   * @returns {Promise<TResultAccumulator>} A promise that resolves with the accumulated results.
   */
  private async exec<TResultAccumulator>(
    request: ReflectionRequest | ReflectionRequest[],
    dataCallback: (response: ReflectionResponse) => void,
    resultAccumulator: TResultAccumulator
  ): Promise<TResultAccumulator> {
    await this.activateClient();
    const client = this.activeGrpcClient!;
    return new Promise((resolve, reject) => {
      let grpcCall: ClientDuplexStream<
        ReflectionRequest,
        ReflectionResponse
      > | null = null;
      const completeCall = (error?: Error) => {
        if (error) reject(error);
        else resolve(resultAccumulator);
      };
      try {
        grpcCall = client.serverReflectionInfo(this.metadata);

        grpcCall.on('data', response => {
          try {
            dataCallback(response);
          } catch (err) {
            completeCall(err as Error);
          }
        });
        grpcCall.on('error', (e: ServiceError) => completeCall(e));
        grpcCall.on('end', () => completeCall());

        // write multiple requests to the stream if needed
        if (Array.isArray(request)) {
          for (const req of request) {
            grpcCall.write(req);
          }
        } else {
          grpcCall.write(request);
        }
        grpcCall.end();
      } catch (err) {
        completeCall(err as Error);
      }
    });
  }

  async listServices(): Promise<string[]> {
    // check cache generated during probe request

    await this.activateClient();
    if (this.serviceListCache !== null) {
      return Promise.resolve(this.serviceListCache);
    }

    const version = this.detectedVersion;
    const ReqClass =
      version === 'v1'
        ? ServerReflectionRequest_v1
        : ServerReflectionRequest_v1alpha;
    const request = new ReqClass();
    request.setListServices('*');

    const services: string[] = [];

    return this.exec<string[]>(
      request,
      (response: ReflectionResponse) => {
        if (response.hasListServicesResponse()) {
          const serviceList = response
            .getListServicesResponse()
            ?.getServiceList()
            .map(svc => {
              return svc.getName();
            });

          if (serviceList) {
            services.push(...serviceList);
          }
        } else if (response.hasErrorResponse()) {
          const err = response.getErrorResponse();
          throw new Error(
            `Error: ${err?.getErrorCode()}: ${err?.getErrorMessage()}`
          );
        } else {
          throw new Error();
        }
      },
      services
    );
  }

  async fileContainingSymbol(symbol: string): Promise<Root> {
    return new Promise((resolve, reject) => {
      this.getFileContainingSymbol(symbol)
        .then(val => resolve(this.resolveFileDescriptorSet(val)))
        .catch(err => reject(err));
    });
  }

  async fileByFilename(filename: string): Promise<Root> {
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

    return getDescriptorRootFromDescriptorSet(
      fileDescriptorSet,
      this.reflectionOptions?.useExperimentalMapFieldDecoding
    );
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
    const fileDescriptorCache = this.fileDescriptorCache;
    const version = await this.activateClient();
    const ReqClass =
      version === 'v1'
        ? ServerReflectionRequest_v1
        : ServerReflectionRequest_v1alpha;
    const request = new ReqClass();
    request.setFileContainingSymbol(symbol);

    const fileDescriptorProtos: Array<IFileDescriptorProto> = [];

    return this.exec<Array<IFileDescriptorProto>>(
      request,
      (response: ReflectionResponse) => {
        if (response.hasFileDescriptorResponse()) {
          const fileDescriptorProtoBytes = (response
            .getFileDescriptorResponse()
            ?.getFileDescriptorProtoList() || []) as Array<Uint8Array>;

          fileDescriptorProtoBytes.forEach(descriptorByte => {
            const fileDescriptorProto = FileDescriptorProto.decode(
              descriptorByte
            ) as IFileDescriptorProto;

            fileDescriptorCache.set(
              fileDescriptorProto.name as string,
              fileDescriptorProto
            );

            fileDescriptorProtos.push(fileDescriptorProto);
          });
        } else if (response.hasErrorResponse()) {
          const err = response.getErrorResponse();
          throw new Error(
            `Error: ${err?.getErrorCode()}: ${err?.getErrorMessage()}`
          );
        } else {
          throw new Error();
        }
      },
      fileDescriptorProtos
    );
  }

  private async getFilesByFilenames(
    symbols: string[]
  ): Promise<Array<IFileDescriptorProto>> {
    const version = await this.activateClient();
    const ReqClass =
      version === 'v1'
        ? ServerReflectionRequest_v1
        : ServerReflectionRequest_v1alpha;

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

    const requests = symbolsToFetch.map(symbol => {
      const request = new ReqClass();
      request.setFileByFilename(symbol);
      return request;
    });

    return this.exec<Array<IFileDescriptorProto>>(
      requests,
      (response: ReflectionResponse) => {
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
          throw new Error(
            `Error: ${err?.getErrorCode()}: ${err?.getErrorMessage()}`
          );
        } else {
          throw new Error();
        }
      },
      result
    );
  }
}
