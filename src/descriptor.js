const protobuf = require('@postman/protobufjs');
const Descriptor = require('@postman/protobufjs/ext/descriptor');
const set = require('lodash.set');

/**
 * @typedef {import('@postman/protobufjs').Root} Root
 * @typedef {import('@postman/protobufjs').Message} Message
 */

/**
 * Get Protobuf.js Root object from the serialized FileDescriptorProto messages
 * that gotten from reflection service.
 * @param {Array<Uint8Array|string>|undefined} file_descriptor_protos - Reflection descriptor protos
 * @param {boolean} [useMapField=false] - Use experimental map field decoding support of protobufjs
 * @return {Root} Protobuf.js Root object
 */
// eslint-disable-next-line node/no-unsupported-features/es-syntax
export function getDescriptorRoot(file_descriptor_protos, useMapField = false) {
  const descriptorSet = Descriptor.FileDescriptorSet.create();

  file_descriptor_protos.forEach((descriptorByte, i) => {
    const descriptor = Descriptor.FileDescriptorProto.decode(descriptorByte);
    set(descriptorSet, 'file[' + i + ']', descriptor);
  });
  return protobuf.Root.fromDescriptor(descriptorSet, {useMapField});
}

/**
 * Get Protobuf.js Root object from FileDescriptorSet
 * @param {Message file_descriptor_set - File descriptor set
 * @param {boolean} [useMapField=false] - Use experimental map field decoding support of protobufjs
 * @return {Root} Protobuf.js Root object
 */
// eslint-disable-next-line node/no-unsupported-features/es-syntax
export function getDescriptorRootFromDescriptorSet(
  file_descriptor_set,
  useMapField = false
) {
  return protobuf.Root.fromDescriptor(file_descriptor_set, {useMapField});
}
