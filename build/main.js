"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contextTypeVar = exports.makeUtils = exports.generateFile = void 0;
const ts_poet_1 = require("ts-poet");
const types_1 = require("./types");
const sourceInfo_1 = require("./sourceInfo");
const utils_1 = require("./utils");
const case_1 = require("./case");
const generate_nestjs_1 = require("./generate-nestjs");
const generate_services_1 = require("./generate-services");
const generate_grpc_web_1 = require("./generate-grpc-web");
const enums_1 = require("./enums");
const visit_1 = require("./visit");
const options_1 = require("./options");
const schema_1 = require("./schema");
const ConditionalOutput_1 = require("ts-poet/build/ConditionalOutput");
const generate_grpc_js_1 = require("./generate-grpc-js");
const generate_generic_service_definition_1 = require("./generate-generic-service-definition");
function generateFile(ctx, fileDesc) {
    var _a;
    const { options, utils } = ctx;
    if (options.useOptionals === false) {
        console.warn("ts-proto: Passing useOptionals as a boolean option is deprecated and will be removed in a future version. Please pass the string 'none' instead of false.");
        options.useOptionals = 'none';
    }
    else if (options.useOptionals === true) {
        console.warn("ts-proto: Passing useOptionals as a boolean option is deprecated and will be removed in a future version. Please pass the string 'messages' instead of true.");
        options.useOptionals = 'messages';
    }
    // Google's protofiles are organized like Java, where package == the folder the file
    // is in, and file == a specific service within the package. I.e. you can have multiple
    // company/foo.proto and company/bar.proto files, where package would be 'company'.
    //
    // We'll match that structure by setting up the module path as:
    //
    // company/foo.proto --> company/foo.ts
    // company/bar.proto --> company/bar.ts
    //
    // We'll also assume that the fileDesc.name is already the `company/foo.proto` path, with
    // the package already implicitly in it, so we won't re-append/strip/etc. it out/back in.
    const suffix = `${options.fileSuffix}.ts`;
    const moduleName = fileDesc.name.replace('.proto', suffix);
    const chunks = [];
    // Indicate this file's source protobuf package for reflective use with google.protobuf.Any
    if (options.exportCommonSymbols) {
        chunks.push(ts_poet_1.code `export const protobufPackage = '${fileDesc.package}';`);
    }
    // Syntax, unlike most fields, is not repeated and thus does not use an index
    const sourceInfo = sourceInfo_1.default.fromDescriptor(fileDesc);
    const headerComment = sourceInfo.lookup(sourceInfo_1.Fields.file.syntax, undefined);
    utils_1.maybeAddComment(headerComment, chunks, (_a = fileDesc.options) === null || _a === void 0 ? void 0 : _a.deprecated);
    // Apply formatting to methods here, so they propagate globally
    for (let svc of fileDesc.service) {
        for (let i = 0; i < svc.method.length; i++) {
            svc.method[i] = new utils_1.FormattedMethodDescriptor(svc.method[i], options);
        }
    }
    // first make all the type declarations
    visit_1.visit(fileDesc, sourceInfo, (fullName, message, sInfo, fullProtoTypeName) => {
        chunks.push(generateInterfaceDeclaration(ctx, fullName, message, sInfo, utils_1.maybePrefixPackage(fileDesc, fullProtoTypeName)));
    }, options, (fullName, enumDesc, sInfo) => {
        chunks.push(enums_1.generateEnum(ctx, fullName, enumDesc, sInfo));
    });
    // If nestJs=true export [package]_PACKAGE_NAME and [service]_SERVICE_NAME const
    if (options.nestJs) {
        const prefix = case_1.camelToSnake(fileDesc.package.replace(/\./g, '_'));
        chunks.push(ts_poet_1.code `export const ${prefix}_PACKAGE_NAME = '${fileDesc.package}';`);
    }
    if (options.outputEncodeMethods || options.outputJsonMethods || options.outputTypeRegistry) {
        // then add the encoder/decoder/base instance
        visit_1.visit(fileDesc, sourceInfo, (fullName, message, sInfo, fullProtoTypeName) => {
            const fullTypeName = utils_1.maybePrefixPackage(fileDesc, fullProtoTypeName);
            chunks.push(generateBaseInstanceFactory(ctx, fullName, message, fullTypeName));
            const staticMembers = [];
            if (options.outputTypeRegistry) {
                staticMembers.push(ts_poet_1.code `$type: '${fullTypeName}' as const`);
            }
            if (options.outputEncodeMethods) {
                staticMembers.push(generateEncode(ctx, fullName, message));
                staticMembers.push(generateDecode(ctx, fullName, message));
            }
            if (options.outputJsonMethods) {
                staticMembers.push(generateFromJson(ctx, fullName, message));
                staticMembers.push(generateToJson(ctx, fullName, message));
            }
            if (options.outputPartialMethods) {
                staticMembers.push(generateFromPartial(ctx, fullName, message));
            }
            staticMembers.push(...generateWrap(ctx, fullTypeName));
            staticMembers.push(...generateUnwrap(ctx, fullTypeName));
            chunks.push(ts_poet_1.code `
          export const ${ts_poet_1.def(fullName)} = {
            ${ts_poet_1.joinCode(staticMembers, { on: ',\n\n' })}
          };
        `);
            if (options.outputTypeRegistry) {
                const messageTypeRegistry = ts_poet_1.imp('messageTypeRegistry@./typeRegistry');
                chunks.push(ts_poet_1.code `
            ${messageTypeRegistry}.set(${fullName}.$type, ${fullName});
          `);
            }
        }, options);
    }
    let hasServerStreamingMethods = false;
    let hasStreamingMethods = false;
    visit_1.visitServices(fileDesc, sourceInfo, (serviceDesc, sInfo) => {
        if (options.nestJs) {
            // NestJS is sufficiently different that we special case all of the client/server interfaces
            // generate nestjs grpc client interface
            chunks.push(generate_nestjs_1.generateNestjsServiceClient(ctx, fileDesc, sInfo, serviceDesc));
            // and the service controller interface
            chunks.push(generate_nestjs_1.generateNestjsServiceController(ctx, fileDesc, sInfo, serviceDesc));
            // generate nestjs grpc service controller decorator
            chunks.push(generate_nestjs_1.generateNestjsGrpcServiceMethodsDecorator(ctx, serviceDesc));
            let serviceConstName = `${case_1.camelToSnake(serviceDesc.name)}_NAME`;
            if (!serviceDesc.name.toLowerCase().endsWith('service')) {
                serviceConstName = `${case_1.camelToSnake(serviceDesc.name)}_SERVICE_NAME`;
            }
            chunks.push(ts_poet_1.code `export const ${serviceConstName} = "${serviceDesc.name}";`);
        }
        else if (options.outputServices === options_1.ServiceOption.GRPC) {
            chunks.push(generate_grpc_js_1.generateGrpcJsService(ctx, fileDesc, sInfo, serviceDesc));
        }
        else if (options.outputServices === options_1.ServiceOption.GENERIC) {
            chunks.push(generate_generic_service_definition_1.generateGenericServiceDefinition(ctx, fileDesc, sInfo, serviceDesc));
        }
        else if (options.outputServices === options_1.ServiceOption.DEFAULT) {
            // This service could be Twirp or grpc-web or JSON (maybe). So far all of their
            // interfaces are fairly similar so we share the same service interface.
            chunks.push(generate_services_1.generateService(ctx, fileDesc, sInfo, serviceDesc));
            if (options.outputClientImpl === true) {
                chunks.push(generate_services_1.generateServiceClientImpl(ctx, fileDesc, serviceDesc));
            }
            else if (options.outputClientImpl === 'grpc-web') {
                chunks.push(generate_grpc_web_1.generateGrpcClientImpl(ctx, fileDesc, serviceDesc));
                chunks.push(generate_grpc_web_1.generateGrpcServiceDesc(fileDesc, serviceDesc));
                serviceDesc.method.forEach((method) => {
                    chunks.push(generate_grpc_web_1.generateGrpcMethodDesc(ctx, serviceDesc, method));
                    if (method.serverStreaming) {
                        hasServerStreamingMethods = true;
                    }
                });
            }
        }
        serviceDesc.method.forEach((methodDesc, index) => {
            if (methodDesc.serverStreaming || methodDesc.clientStreaming) {
                hasStreamingMethods = true;
            }
        });
    });
    if (options.outputServices === options_1.ServiceOption.DEFAULT && options.outputClientImpl && fileDesc.service.length > 0) {
        if (options.outputClientImpl === true) {
            chunks.push(generate_services_1.generateRpcType(ctx, hasStreamingMethods));
        }
        else if (options.outputClientImpl === 'grpc-web') {
            chunks.push(generate_grpc_web_1.addGrpcWebMisc(ctx, hasServerStreamingMethods));
        }
    }
    if (options.context) {
        chunks.push(generate_services_1.generateDataLoaderOptionsType());
        chunks.push(generate_services_1.generateDataLoadersType());
    }
    if (options.outputSchema) {
        chunks.push(...schema_1.generateSchema(ctx, fileDesc, sourceInfo));
    }
    chunks.push(...Object.values(utils).map((v) => {
        if (v instanceof ConditionalOutput_1.ConditionalOutput) {
            return ts_poet_1.code `${v.ifUsed}`;
        }
        else if (v instanceof ts_poet_1.Code) {
            return v;
        }
        else {
            return ts_poet_1.code ``;
        }
    }));
    // Finally, reset method definitions to their original state (unformatted)
    // This is mainly so that the `meta-typings` tests pass
    for (let svc of fileDesc.service) {
        for (let i = 0; i < svc.method.length; i++) {
            const methodInfo = svc.method[i];
            utils_1.assertInstanceOf(methodInfo, utils_1.FormattedMethodDescriptor);
            svc.method[i] = methodInfo.getSource();
        }
    }
    return [moduleName, ts_poet_1.joinCode(chunks, { on: '\n\n' })];
}
exports.generateFile = generateFile;
/** These are runtime utility methods used by the generated code. */
function makeUtils(options) {
    const bytes = makeByteUtils();
    const longs = makeLongUtils(options, bytes);
    return {
        ...bytes,
        ...makeDeepPartial(options, longs),
        ...makeObjectIdMethods(options),
        ...makeTimestampMethods(options, longs),
        ...longs,
        ...makeComparisonUtils(),
    };
}
exports.makeUtils = makeUtils;
function makeLongUtils(options, bytes) {
    // Regardless of which `forceLong` config option we're using, we always use
    // the `long` library to either represent or at least sanity-check 64-bit values
    const util = ts_poet_1.imp('util@protobufjs/minimal');
    const configure = ts_poet_1.imp('configure@protobufjs/minimal');
    // Before esModuleInterop, we had to use 'import * as Long from long` b/c long is
    // an `export =` module and exports only the Long constructor (which is callable).
    // See https://www.typescriptlang.org/docs/handbook/modules.html#export--and-import--require.
    //
    // With esModuleInterop on, `* as Long` is no longer the constructor, it's the module,
    // so we want to go back to `import { Long } from long`, which is specifically forbidden
    // due to `export =` w/o esModuleInterop.
    //
    // I.e there is not an import for long that "just works" in both esModuleInterop and
    // not esModuleInterop.
    const Long = options.esModuleInterop ? ts_poet_1.imp('Long=long') : ts_poet_1.imp('Long*long');
    const disclaimer = options.esModuleInterop
        ? ''
        : `
    // If you get a compile-error about 'Constructor<Long> and ... have no overlap',
    // add '--ts_proto_opt=esModuleInterop=true' as a flag when calling 'protoc'.`;
    // Kinda hacky, but we always init long unless in onlyTypes mode. I'd rather do
    // this more implicitly, like if `Long@long` is imported or something like that.
    const longInit = options.onlyTypes
        ? ts_poet_1.code ``
        : ts_poet_1.code `
      ${disclaimer}
      if (${util}.Long !== ${Long}) {
        ${util}.Long = ${Long} as any;
        ${configure}();
      }
    `;
    // TODO This is unused?
    const numberToLong = ts_poet_1.conditionalOutput('numberToLong', ts_poet_1.code `
      function numberToLong(number: number) {
        return ${Long}.fromNumber(number);
      }
    `);
    const longToString = ts_poet_1.conditionalOutput('longToString', ts_poet_1.code `
      function longToString(long: ${Long}) {
        return long.toString();
      }
    `);
    const longToNumber = ts_poet_1.conditionalOutput('longToNumber', ts_poet_1.code `
      function longToNumber(long: ${Long}): number {
        if (long.gt(Number.MAX_SAFE_INTEGER)) {
          throw new ${bytes.globalThis}.Error("Value is larger than Number.MAX_SAFE_INTEGER")
        }
        return long.toNumber();
      }
    `);
    return { numberToLong, longToNumber, longToString, longInit, Long };
}
function makeByteUtils() {
    const globalThis = ts_poet_1.conditionalOutput('globalThis', ts_poet_1.code `
      declare var self: any | undefined;
      declare var window: any | undefined;
      declare var global: any | undefined;
      var globalThis: any = (() => {
        if (typeof globalThis !== "undefined") return globalThis;
        if (typeof self !== "undefined") return self;
        if (typeof window !== "undefined") return window;
        if (typeof global !== "undefined") return global;
        throw "Unable to locate global object";
      })();
    `);
    const bytesFromBase64 = ts_poet_1.conditionalOutput('bytesFromBase64', ts_poet_1.code `
      const atob: (b64: string) => string = ${globalThis}.atob || ((b64) => ${globalThis}.Buffer.from(b64, 'base64').toString('binary'));
      function bytesFromBase64(b64: string): Uint8Array {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; ++i) {
            arr[i] = bin.charCodeAt(i);
        }
        return arr;
      }
    `);
    const base64FromBytes = ts_poet_1.conditionalOutput('base64FromBytes', ts_poet_1.code `
      const btoa : (bin: string) => string = ${globalThis}.btoa || ((bin) => ${globalThis}.Buffer.from(bin, 'binary').toString('base64'));
      function base64FromBytes(arr: Uint8Array): string {
        const bin: string[] = [];
        for (const byte of arr) {
          bin.push(String.fromCharCode(byte));
        }
        return btoa(bin.join(''));
      }
    `);
    return { globalThis, bytesFromBase64, base64FromBytes };
}
function makeDeepPartial(options, longs) {
    let oneofCase = '';
    if (options.oneof === options_1.OneofOption.UNIONS) {
        oneofCase = `
      : T extends { $case: string }
      ? { [K in keyof Omit<T, '$case'>]?: DeepPartial<T[K]> } & { $case: T['$case'] }
    `;
    }
    const maybeExport = options.exportCommonSymbols ? 'export' : '';
    // Allow passing longs as numbers or strings, nad we'll convert them
    const maybeLong = options.forceLong === options_1.LongOption.LONG ? ts_poet_1.code ` : T extends ${longs.Long} ? string | number | Long ` : '';
    const Builtin = ts_poet_1.conditionalOutput('Builtin', ts_poet_1.code `type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;`);
    // Based on https://github.com/sindresorhus/type-fest/pull/259
    const maybeExcludeType = options.outputTypeRegistry ? `| '$type'` : '';
    const Exact = ts_poet_1.conditionalOutput('Exact', ts_poet_1.code `
      type KeysOfUnion<T> = T extends T ? keyof T : never;
      ${maybeExport} type Exact<P, I extends P> = P extends ${Builtin}
        ? P
        : P &
        { [K in keyof P]: Exact<P[K], I[K]> } & Record<Exclude<keyof I, KeysOfUnion<P> ${maybeExcludeType}>, never>;
    `);
    // Based on the type from ts-essentials
    const keys = options.outputTypeRegistry ? ts_poet_1.code `Exclude<keyof T, '$type'>` : ts_poet_1.code `keyof T`;
    const DeepPartial = ts_poet_1.conditionalOutput('DeepPartial', ts_poet_1.code `
      ${maybeExport} type DeepPartial<T> =  T extends ${Builtin}
        ? T
        ${maybeLong}
        : T extends Array<infer U>
        ? Array<DeepPartial<U>>
        : T extends ReadonlyArray<infer U>
        ? ReadonlyArray<DeepPartial<U>>${oneofCase}
        : T extends {}
        ? { [K in ${keys}]?: DeepPartial<T[K]> }
        : Partial<T>;
    `);
    return { Builtin, DeepPartial, Exact };
}
function makeObjectIdMethods(options) {
    const mongodb = ts_poet_1.imp('mongodb*mongodb');
    const fromProtoObjectId = ts_poet_1.conditionalOutput('fromProtoObjectId', ts_poet_1.code `
      function fromProtoObjectId(oid: ObjectId): ${mongodb}.ObjectId {
        return new ${mongodb}.ObjectId(oid.value);
      }
    `);
    const fromJsonObjectId = ts_poet_1.conditionalOutput('fromJsonObjectId', ts_poet_1.code `
      function fromJsonObjectId(o: any): ${mongodb}.ObjectId {
        if (o instanceof ${mongodb}.ObjectId) {
          return o;
        } else if (typeof o === "string") {
          return new ${mongodb}.ObjectId(o);
        } else {
          return ${fromProtoObjectId}(ObjectId.fromJSON(o));
        }
      }
    `);
    const toProtoObjectId = ts_poet_1.conditionalOutput('toProtoObjectId', ts_poet_1.code `
      function toProtoObjectId(oid: ${mongodb}.ObjectId): ObjectId {
        const value = oid.toString();
        return { value };
      }
    `);
    return { fromJsonObjectId, fromProtoObjectId, toProtoObjectId };
}
function makeTimestampMethods(options, longs) {
    const Timestamp = utils_1.impProto(options, 'google/protobuf/timestamp', 'Timestamp');
    let seconds = 'date.getTime() / 1_000';
    let toNumberCode = 't.seconds';
    if (options.forceLong === options_1.LongOption.LONG) {
        toNumberCode = 't.seconds.toNumber()';
        seconds = ts_poet_1.code `${longs.numberToLong}(date.getTime() / 1_000)`;
    }
    else if (options.forceLong === options_1.LongOption.STRING) {
        toNumberCode = 'Number(t.seconds)';
        // Must discard the fractional piece here
        // Otherwise the fraction ends up on the seconds when parsed as a Long
        // (note this only occurs when the string is > 8 characters)
        seconds = 'Math.trunc(date.getTime() / 1_000).toString()';
    }
    const maybeTypeField = options.outputTypeRegistry ? `$type: 'google.protobuf.Timestamp',` : '';
    const toTimestamp = ts_poet_1.conditionalOutput('toTimestamp', options.useDate === options_1.DateOption.STRING
        ? ts_poet_1.code `
          function toTimestamp(dateStr: string): ${Timestamp} {
            const date = new Date(dateStr);
            const seconds = ${seconds};
            const nanos = (date.getTime() % 1_000) * 1_000_000;
            return { ${maybeTypeField} seconds, nanos };
          }
        `
        : ts_poet_1.code `
          function toTimestamp(date: Date): ${Timestamp} {
            const seconds = ${seconds};
            const nanos = (date.getTime() % 1_000) * 1_000_000;
            return { ${maybeTypeField} seconds, nanos };
          }
        `);
    const fromTimestamp = ts_poet_1.conditionalOutput('fromTimestamp', options.useDate === options_1.DateOption.STRING
        ? ts_poet_1.code `
          function fromTimestamp(t: ${Timestamp}): string {
            let millis = ${toNumberCode} * 1_000;
            millis += t.nanos / 1_000_000;
            return new Date(millis).toISOString();
          }
        `
        : ts_poet_1.code `
          function fromTimestamp(t: ${Timestamp}): Date {
            let millis = ${toNumberCode} * 1_000;
            millis += t.nanos / 1_000_000;
            return new Date(millis);
          }
        `);
    const fromJsonTimestamp = ts_poet_1.conditionalOutput('fromJsonTimestamp', options.useDate === options_1.DateOption.DATE
        ? ts_poet_1.code `
        function fromJsonTimestamp(o: any): Date {
          if (o instanceof Date) {
            return o;
          } else if (typeof o === "string") {
            return new Date(o);
          } else {
            return ${fromTimestamp}(Timestamp.fromJSON(o));
          }
        }
      `
        : ts_poet_1.code `
        function fromJsonTimestamp(o: any): Timestamp {
          if (o instanceof Date) {
            return ${toTimestamp}(o);
          } else if (typeof o === "string") {
            return ${toTimestamp}(new Date(o));
          } else {
            return Timestamp.fromJSON(o);
          }
        }
      `);
    return { toTimestamp, fromTimestamp, fromJsonTimestamp };
}
function makeComparisonUtils() {
    const isObject = ts_poet_1.conditionalOutput('isObject', ts_poet_1.code `
    function isObject(value: any): boolean {
      return typeof value === 'object' && value !== null;
    }`);
    const isSet = ts_poet_1.conditionalOutput('isSet', ts_poet_1.code `
    function isSet(value: any): boolean {
      return value !== null && value !== undefined;
    }`);
    return { isObject, isSet };
}
// Create the interface with properties
function generateInterfaceDeclaration(ctx, fullName, messageDesc, sourceInfo, fullTypeName) {
    var _a;
    const { options } = ctx;
    const chunks = [];
    utils_1.maybeAddComment(sourceInfo, chunks, (_a = messageDesc.options) === null || _a === void 0 ? void 0 : _a.deprecated);
    // interface name should be defined to avoid import collisions
    chunks.push(ts_poet_1.code `export interface ${ts_poet_1.def(fullName)} {`);
    if (ctx.options.outputTypeRegistry) {
        chunks.push(ts_poet_1.code `$type: '${fullTypeName}',`);
    }
    // When oneof=unions, we generate a single property with an ADT per `oneof` clause.
    const processedOneofs = new Set();
    messageDesc.field.forEach((fieldDesc, index) => {
        var _a;
        if (types_1.isWithinOneOfThatShouldBeUnion(options, fieldDesc)) {
            const { oneofIndex } = fieldDesc;
            if (!processedOneofs.has(oneofIndex)) {
                processedOneofs.add(oneofIndex);
                chunks.push(generateOneofProperty(ctx, messageDesc, oneofIndex, sourceInfo));
            }
            return;
        }
        const info = sourceInfo.lookup(sourceInfo_1.Fields.message.field, index);
        utils_1.maybeAddComment(info, chunks, (_a = fieldDesc.options) === null || _a === void 0 ? void 0 : _a.deprecated);
        const name = case_1.maybeSnakeToCamel(fieldDesc.name, options);
        const type = types_1.toTypeName(ctx, messageDesc, fieldDesc);
        const q = types_1.isOptionalProperty(fieldDesc, messageDesc.options, options) ? '?' : '';
        chunks.push(ts_poet_1.code `${name}${q}: ${type}, `);
    });
    chunks.push(ts_poet_1.code `}`);
    return ts_poet_1.joinCode(chunks, { on: '\n' });
}
function generateOneofProperty(ctx, messageDesc, oneofIndex, sourceInfo) {
    const { options } = ctx;
    const fields = messageDesc.field.filter((field) => types_1.isWithinOneOf(field) && field.oneofIndex === oneofIndex);
    const unionType = ts_poet_1.joinCode(fields.map((f) => {
        let fieldName = case_1.maybeSnakeToCamel(f.name, options);
        let typeName = types_1.toTypeName(ctx, messageDesc, f);
        return ts_poet_1.code `{ $case: '${fieldName}', ${fieldName}: ${typeName} }`;
    }), { on: ' | ' });
    const name = case_1.maybeSnakeToCamel(messageDesc.oneofDecl[oneofIndex].name, options);
    return ts_poet_1.code `${name}?: ${unionType},`;
    /*
    // Ideally we'd put the comments for each oneof field next to the anonymous
    // type we've created in the type union above, but ts-poet currently lacks
    // that ability. For now just concatenate all comments into one big one.
    let comments: Array<string> = [];
    const info = sourceInfo.lookup(Fields.message.oneof_decl, oneofIndex);
    maybeAddComment(info, (text) => comments.push(text));
    messageDesc.field.forEach((field, index) => {
      if (!isWithinOneOf(field) || field.oneofIndex !== oneofIndex) {
        return;
      }
      const info = sourceInfo.lookup(Fields.message.field, index);
      const name = maybeSnakeToCamel(field.name, options);
      maybeAddComment(info, (text) => comments.push(name + '\n' + text));
    });
    if (comments.length) {
      prop = prop.addJavadoc(comments.join('\n'));
    }
    return prop;
    */
}
// Create a function that constructs 'base' instance with default values for decode to use as a prototype
function generateBaseInstanceFactory(ctx, fullName, messageDesc, fullTypeName) {
    const fields = [];
    // When oneof=unions, we generate a single property with an ADT per `oneof` clause.
    const processedOneofs = new Set();
    for (const field of messageDesc.field) {
        if (types_1.isWithinOneOfThatShouldBeUnion(ctx.options, field)) {
            const { oneofIndex } = field;
            if (!processedOneofs.has(oneofIndex)) {
                processedOneofs.add(oneofIndex);
                const name = case_1.maybeSnakeToCamel(messageDesc.oneofDecl[oneofIndex].name, ctx.options);
                fields.push(ts_poet_1.code `${name}: undefined`);
            }
            continue;
        }
        const name = case_1.maybeSnakeToCamel(field.name, ctx.options);
        const val = types_1.isWithinOneOf(field)
            ? 'undefined'
            : types_1.isMapType(ctx, messageDesc, field)
                ? '{}'
                : types_1.isRepeated(field)
                    ? '[]'
                    : types_1.defaultValue(ctx, field);
        fields.push(ts_poet_1.code `${name}: ${val}`);
    }
    if (ctx.options.outputTypeRegistry) {
        fields.unshift(ts_poet_1.code `$type: '${fullTypeName}'`);
    }
    return ts_poet_1.code `
    function createBase${fullName}(): ${fullName} {
      return { ${ts_poet_1.joinCode(fields, { on: ',' })} };
    }
  `;
}
/** Creates a function to decode a message by loop overing the tags. */
function generateDecode(ctx, fullName, messageDesc) {
    const { options, utils, typeMap } = ctx;
    const chunks = [];
    let createBase = ts_poet_1.code `createBase${fullName}()`;
    if (options.usePrototypeForDefaults) {
        createBase = ts_poet_1.code `Object.create(${createBase}) as ${fullName}`;
    }
    // create the basic function declaration
    chunks.push(ts_poet_1.code `
    decode(
      input: ${Reader} | Uint8Array,
      length?: number,
    ): ${fullName} {
      const reader = input instanceof ${Reader} ? input : new ${Reader}(input);
      let end = length === undefined ? reader.len : reader.pos + length;
      const message = ${createBase};
  `);
    if (options.unknownFields) {
        chunks.push(ts_poet_1.code `(message as any)._unknownFields = {}`);
    }
    // start the tag loop
    chunks.push(ts_poet_1.code `
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
  `);
    // add a case for each incoming field
    messageDesc.field.forEach((field) => {
        const fieldName = case_1.maybeSnakeToCamel(field.name, options);
        chunks.push(ts_poet_1.code `case ${field.number}:`);
        // get a generic 'reader.doSomething' bit that is specific to the basic type
        let readSnippet;
        if (types_1.isPrimitive(field)) {
            readSnippet = ts_poet_1.code `reader.${types_1.toReaderCall(field)}()`;
            if (types_1.isBytes(field)) {
                if (options.env === options_1.EnvOption.NODE) {
                    readSnippet = ts_poet_1.code `${readSnippet} as Buffer`;
                }
            }
            else if (types_1.basicLongWireType(field.type) !== undefined) {
                if (options.forceLong === options_1.LongOption.LONG) {
                    readSnippet = ts_poet_1.code `${readSnippet} as Long`;
                }
                else if (options.forceLong === options_1.LongOption.STRING) {
                    readSnippet = ts_poet_1.code `${utils.longToString}(${readSnippet} as Long)`;
                }
                else {
                    readSnippet = ts_poet_1.code `${utils.longToNumber}(${readSnippet} as Long)`;
                }
            }
            else if (types_1.isEnum(field)) {
                if (options.stringEnums) {
                    const fromJson = types_1.getEnumMethod(ctx, field.typeName, 'FromJSON');
                    readSnippet = ts_poet_1.code `${fromJson}(${readSnippet})`;
                }
                else {
                    readSnippet = ts_poet_1.code `${readSnippet} as any`;
                }
            }
        }
        else if (types_1.isValueType(ctx, field)) {
            const type = types_1.basicTypeName(ctx, field, { keepValueType: true });
            const unwrap = (decodedValue) => {
                if (types_1.isListValueType(field) || types_1.isStructType(field) || types_1.isAnyValueType(field)) {
                    return ts_poet_1.code `${type}.unwrap(${decodedValue})`;
                }
                return ts_poet_1.code `${decodedValue}.value`;
            };
            const decoder = ts_poet_1.code `${type}.decode(reader, reader.uint32())`;
            readSnippet = ts_poet_1.code `${unwrap(decoder)}`;
        }
        else if (types_1.isTimestamp(field) && (options.useDate === options_1.DateOption.DATE || options.useDate === options_1.DateOption.STRING)) {
            const type = types_1.basicTypeName(ctx, field, { keepValueType: true });
            readSnippet = ts_poet_1.code `${utils.fromTimestamp}(${type}.decode(reader, reader.uint32()))`;
        }
        else if (types_1.isObjectId(field) && options.useMongoObjectId) {
            const type = types_1.basicTypeName(ctx, field, { keepValueType: true });
            readSnippet = ts_poet_1.code `${utils.fromProtoObjectId}(${type}.decode(reader, reader.uint32()))`;
        }
        else if (types_1.isMessage(field)) {
            const type = types_1.basicTypeName(ctx, field);
            readSnippet = ts_poet_1.code `${type}.decode(reader, reader.uint32())`;
        }
        else {
            throw new Error(`Unhandled field ${field}`);
        }
        // and then use the snippet to handle repeated fields if necessary
        if (types_1.isRepeated(field)) {
            const maybeNonNullAssertion = ctx.options.useOptionals === 'all' ? '!' : '';
            if (types_1.isMapType(ctx, messageDesc, field)) {
                // We need a unique const within the `cast` statement
                const varName = `entry${field.number}`;
                chunks.push(ts_poet_1.code `
          const ${varName} = ${readSnippet};
          if (${varName}.value !== undefined) {
            message.${fieldName}${maybeNonNullAssertion}[${varName}.key] = ${varName}.value;
          }
        `);
            }
            else if (types_1.packedType(field.type) === undefined) {
                chunks.push(ts_poet_1.code `message.${fieldName}${maybeNonNullAssertion}.push(${readSnippet});`);
            }
            else {
                chunks.push(ts_poet_1.code `
          if ((tag & 7) === 2) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.${fieldName}${maybeNonNullAssertion}.push(${readSnippet});
            }
          } else {
            message.${fieldName}${maybeNonNullAssertion}.push(${readSnippet});
          }
        `);
            }
        }
        else if (types_1.isWithinOneOfThatShouldBeUnion(options, field)) {
            let oneofName = case_1.maybeSnakeToCamel(messageDesc.oneofDecl[field.oneofIndex].name, options);
            chunks.push(ts_poet_1.code `message.${oneofName} = { $case: '${fieldName}', ${fieldName}: ${readSnippet} };`);
        }
        else {
            chunks.push(ts_poet_1.code `message.${fieldName} = ${readSnippet};`);
        }
        chunks.push(ts_poet_1.code `break;`);
    });
    if (options.unknownFields) {
        chunks.push(ts_poet_1.code `
      default:
        const startPos = reader.pos;
        reader.skipType(tag & 7);
        (message as any)._unknownFields[tag] = [...((message as any)._unknownFields[tag] || []), reader.buf.slice(startPos, reader.pos)];
        break;
    `);
    }
    else {
        chunks.push(ts_poet_1.code `
      default:
        reader.skipType(tag & 7);
        break;
    `);
    }
    // and then wrap up the switch/while/return
    chunks.push(ts_poet_1.code `}`);
    chunks.push(ts_poet_1.code `}`);
    chunks.push(ts_poet_1.code `return message;`);
    chunks.push(ts_poet_1.code `}`);
    return ts_poet_1.joinCode(chunks, { on: '\n' });
}
const Writer = ts_poet_1.imp('Writer@protobufjs/minimal');
const Reader = ts_poet_1.imp('Reader@protobufjs/minimal');
/** Creates a function to encode a message by loop overing the tags. */
function generateEncode(ctx, fullName, messageDesc) {
    const { options, utils, typeMap } = ctx;
    const chunks = [];
    // create the basic function declaration
    chunks.push(ts_poet_1.code `
    encode(
      ${messageDesc.field.length > 0 || options.unknownFields ? 'message' : '_'}: ${fullName},
      writer: ${Writer} = ${Writer}.create(),
    ): ${Writer} {
  `);
    // then add a case for each field
    messageDesc.field.forEach((field) => {
        const fieldName = case_1.maybeSnakeToCamel(field.name, options);
        // get a generic writer.doSomething based on the basic type
        let writeSnippet;
        if (types_1.isEnum(field) && options.stringEnums) {
            const tag = ((field.number << 3) | types_1.basicWireType(field.type)) >>> 0;
            const toNumber = types_1.getEnumMethod(ctx, field.typeName, 'ToNumber');
            writeSnippet = (place) => ts_poet_1.code `writer.uint32(${tag}).${types_1.toReaderCall(field)}(${toNumber}(${place}))`;
        }
        else if (types_1.isScalar(field) || types_1.isEnum(field)) {
            const tag = ((field.number << 3) | types_1.basicWireType(field.type)) >>> 0;
            writeSnippet = (place) => ts_poet_1.code `writer.uint32(${tag}).${types_1.toReaderCall(field)}(${place})`;
        }
        else if (types_1.isObjectId(field) && options.useMongoObjectId) {
            const tag = ((field.number << 3) | 2) >>> 0;
            const type = types_1.basicTypeName(ctx, field, { keepValueType: true });
            writeSnippet = (place) => ts_poet_1.code `${type}.encode(${utils.toProtoObjectId}(${place}), writer.uint32(${tag}).fork()).ldelim()`;
        }
        else if (types_1.isTimestamp(field) && (options.useDate === options_1.DateOption.DATE || options.useDate === options_1.DateOption.STRING)) {
            const tag = ((field.number << 3) | 2) >>> 0;
            const type = types_1.basicTypeName(ctx, field, { keepValueType: true });
            writeSnippet = (place) => ts_poet_1.code `${type}.encode(${utils.toTimestamp}(${place}), writer.uint32(${tag}).fork()).ldelim()`;
        }
        else if (types_1.isValueType(ctx, field)) {
            const maybeTypeField = options.outputTypeRegistry ? `$type: '${field.typeName.slice(1)}',` : '';
            const type = types_1.basicTypeName(ctx, field, { keepValueType: true });
            const wrappedValue = (place) => {
                if (types_1.isAnyValueType(field) || types_1.isListValueType(field) || types_1.isStructType(field)) {
                    return ts_poet_1.code `${type}.wrap(${place})`;
                }
                return ts_poet_1.code `{${maybeTypeField} value: ${place}!}`;
            };
            const tag = ((field.number << 3) | 2) >>> 0;
            writeSnippet = (place) => ts_poet_1.code `${type}.encode(${wrappedValue(place)}, writer.uint32(${tag}).fork()).ldelim()`;
        }
        else if (types_1.isMessage(field)) {
            const tag = ((field.number << 3) | 2) >>> 0;
            const type = types_1.basicTypeName(ctx, field);
            writeSnippet = (place) => ts_poet_1.code `${type}.encode(${place}, writer.uint32(${tag}).fork()).ldelim()`;
        }
        else {
            throw new Error(`Unhandled field ${field}`);
        }
        const isOptional = types_1.isOptionalProperty(field, messageDesc.options, options);
        if (types_1.isRepeated(field)) {
            if (types_1.isMapType(ctx, messageDesc, field)) {
                const valueType = typeMap.get(field.typeName)[2].field[1];
                const maybeTypeField = options.outputTypeRegistry ? `$type: '${field.typeName.slice(1)}',` : '';
                const entryWriteSnippet = types_1.isValueType(ctx, valueType)
                    ? ts_poet_1.code `
              if (value !== undefined) {
                ${writeSnippet(`{ ${maybeTypeField} key: key as any, value }`)};
              }
            `
                    : writeSnippet(`{ ${maybeTypeField} key: key as any, value }`);
                const optionalAlternative = isOptional ? ' || {}' : '';
                chunks.push(ts_poet_1.code `
          Object.entries(message.${fieldName}${optionalAlternative}).forEach(([key, value]) => {
            ${entryWriteSnippet}
          });
        `);
            }
            else if (types_1.packedType(field.type) === undefined) {
                const listWriteSnippet = ts_poet_1.code `
          for (const v of message.${fieldName}) {
            ${writeSnippet('v!')};
          }
        `;
                if (isOptional) {
                    chunks.push(ts_poet_1.code `
            if (message.${fieldName} !== undefined && message.${fieldName}.length !== 0) {
              ${listWriteSnippet}
            }
          `);
                }
                else {
                    chunks.push(listWriteSnippet);
                }
            }
            else if (types_1.isEnum(field) && options.stringEnums) {
                // This is a lot like the `else` clause, but we wrap `fooToNumber` around it.
                // Ideally we'd reuse `writeSnippet` here, but `writeSnippet` has the `writer.uint32(tag)`
                // embedded inside of it, and we want to drop that so that we can encode it packed
                // (i.e. just one tag and multiple values).
                const tag = ((field.number << 3) | 2) >>> 0;
                const toNumber = types_1.getEnumMethod(ctx, field.typeName, 'ToNumber');
                const listWriteSnippet = ts_poet_1.code `
          writer.uint32(${tag}).fork();
          for (const v of message.${fieldName}) {
            writer.${types_1.toReaderCall(field)}(${toNumber}(v));
          }
          writer.ldelim();
        `;
                if (isOptional) {
                    chunks.push(ts_poet_1.code `
            if (message.${fieldName} !== undefined && message.${fieldName}.length !== 0) {
              ${listWriteSnippet}
            }
          `);
                }
                else {
                    chunks.push(listWriteSnippet);
                }
            }
            else {
                // Ideally we'd reuse `writeSnippet` but it has tagging embedded inside of it.
                const tag = ((field.number << 3) | 2) >>> 0;
                const listWriteSnippet = ts_poet_1.code `
          writer.uint32(${tag}).fork();
          for (const v of message.${fieldName}) {
            writer.${types_1.toReaderCall(field)}(v);
          }
          writer.ldelim();
        `;
                if (isOptional) {
                    chunks.push(ts_poet_1.code `
            if (message.${fieldName} !== undefined && message.${fieldName}.length !== 0) {
              ${listWriteSnippet}
            }
          `);
                }
                else {
                    chunks.push(listWriteSnippet);
                }
            }
        }
        else if (types_1.isWithinOneOfThatShouldBeUnion(options, field)) {
            let oneofName = case_1.maybeSnakeToCamel(messageDesc.oneofDecl[field.oneofIndex].name, options);
            chunks.push(ts_poet_1.code `
        if (message.${oneofName}?.$case === '${fieldName}') {
          ${writeSnippet(`message.${oneofName}.${fieldName}`)};
        }
      `);
        }
        else if (types_1.isWithinOneOf(field)) {
            // Oneofs don't have a default value check b/c they need to denote which-oneof presence
            chunks.push(ts_poet_1.code `
        if (message.${fieldName} !== undefined) {
          ${writeSnippet(`message.${fieldName}`)};
        }
      `);
        }
        else if (types_1.isMessage(field)) {
            chunks.push(ts_poet_1.code `
        if (message.${fieldName} !== undefined) {
          ${writeSnippet(`message.${fieldName}`)};
        }
      `);
        }
        else if (types_1.isScalar(field) || types_1.isEnum(field)) {
            chunks.push(ts_poet_1.code `
        if (${types_1.notDefaultCheck(ctx, field, messageDesc.options, `message.${fieldName}`)}) {
          ${writeSnippet(`message.${fieldName}`)};
        }
      `);
        }
        else {
            chunks.push(ts_poet_1.code `${writeSnippet(`message.${fieldName}`)};`);
        }
    });
    if (options.unknownFields) {
        chunks.push(ts_poet_1.code `if ('_unknownFields' in message) {
      for (const key of Object.keys(message['_unknownFields'])) {
        const values = message['_unknownFields'][key] as Uint8Array[];
        for (const value of values) {
          writer.uint32(parseInt(key, 10));
          (writer as any)['_push'](
            (val: Uint8Array, buf: Buffer, pos: number) => buf.set(val, pos),
            value.length,
            value
          );
        }
      }
    }`);
    }
    chunks.push(ts_poet_1.code `return writer;`);
    chunks.push(ts_poet_1.code `}`);
    return ts_poet_1.joinCode(chunks, { on: '\n' });
}
/**
 * Creates a function to decode a message from JSON.
 *
 * This is very similar to decode, we loop through looking for properties, with
 * a few special cases for https://developers.google.com/protocol-buffers/docs/proto3#json.
 * */
function generateFromJson(ctx, fullName, messageDesc) {
    const { options, utils, typeMap } = ctx;
    const chunks = [];
    // create the basic function declaration
    chunks.push(ts_poet_1.code `
    fromJSON(${messageDesc.field.length > 0 ? 'object' : '_'}: any): ${fullName} {
      return {
  `);
    if (ctx.options.outputTypeRegistry) {
        chunks.push(ts_poet_1.code `$type: ${fullName}.$type,`);
    }
    const oneofFieldsCases = messageDesc.oneofDecl.map((oneof, oneofIndex) => messageDesc.field.filter(types_1.isWithinOneOf).filter((field) => field.oneofIndex === oneofIndex));
    // add a check for each incoming field
    messageDesc.field.forEach((field) => {
        const fieldName = case_1.maybeSnakeToCamel(field.name, options);
        const jsonName = utils_1.determineFieldJsonName(field, options);
        // get code that extracts value from incoming object
        const readSnippet = (from) => {
            if (types_1.isEnum(field)) {
                const fromJson = types_1.getEnumMethod(ctx, field.typeName, 'FromJSON');
                return ts_poet_1.code `${fromJson}(${from})`;
            }
            else if (types_1.isPrimitive(field)) {
                // Convert primitives using the String(value)/Number(value)/bytesFromBase64(value)
                if (types_1.isBytes(field)) {
                    if (options.env === options_1.EnvOption.NODE) {
                        return ts_poet_1.code `Buffer.from(${utils.bytesFromBase64}(${from}))`;
                    }
                    else {
                        return ts_poet_1.code `${utils.bytesFromBase64}(${from})`;
                    }
                }
                else if (types_1.isLong(field) && options.forceLong === options_1.LongOption.LONG) {
                    const cstr = case_1.capitalize(types_1.basicTypeName(ctx, field, { keepValueType: true }).toCodeString());
                    return ts_poet_1.code `${cstr}.fromString(${from})`;
                }
                else {
                    const cstr = case_1.capitalize(types_1.basicTypeName(ctx, field, { keepValueType: true }).toCodeString());
                    return ts_poet_1.code `${cstr}(${from})`;
                }
            }
            else if (types_1.isObjectId(field) && options.useMongoObjectId) {
                return ts_poet_1.code `${utils.fromJsonObjectId}(${from})`;
            }
            else if (types_1.isTimestamp(field) && options.useDate === options_1.DateOption.STRING) {
                return ts_poet_1.code `String(${from})`;
            }
            else if (types_1.isTimestamp(field) &&
                (options.useDate === options_1.DateOption.DATE || options.useDate === options_1.DateOption.TIMESTAMP)) {
                return ts_poet_1.code `${utils.fromJsonTimestamp}(${from})`;
            }
            else if (types_1.isAnyValueType(field) || types_1.isStructType(field)) {
                return ts_poet_1.code `${from}`;
            }
            else if (types_1.isFieldMaskType(field)) {
                return ts_poet_1.code `{paths: ${from}.split(",")}`;
            }
            else if (types_1.isListValueType(field)) {
                return ts_poet_1.code `[...${from}]`;
            }
            else if (types_1.isValueType(ctx, field)) {
                const valueType = types_1.valueTypeName(ctx, field.typeName);
                if (types_1.isLongValueType(field) && options.forceLong === options_1.LongOption.LONG) {
                    return ts_poet_1.code `${case_1.capitalize(valueType.toCodeString())}.fromValue(${from})`;
                }
                else if (types_1.isBytesValueType(field)) {
                    return ts_poet_1.code `new ${case_1.capitalize(valueType.toCodeString())}(${from})`;
                }
                else {
                    return ts_poet_1.code `${case_1.capitalize(valueType.toCodeString())}(${from})`;
                }
            }
            else if (types_1.isMessage(field)) {
                if (types_1.isRepeated(field) && types_1.isMapType(ctx, messageDesc, field)) {
                    const valueType = typeMap.get(field.typeName)[2].field[1];
                    if (types_1.isPrimitive(valueType)) {
                        // TODO Can we not copy/paste this from ^?
                        if (types_1.isBytes(valueType)) {
                            if (options.env === options_1.EnvOption.NODE) {
                                return ts_poet_1.code `Buffer.from(${utils.bytesFromBase64}(${from} as string))`;
                            }
                            else {
                                return ts_poet_1.code `${utils.bytesFromBase64}(${from} as string)`;
                            }
                        }
                        else if (types_1.isLong(valueType) && options.forceLong === options_1.LongOption.LONG) {
                            return ts_poet_1.code `Long.fromValue(${from} as Long | string)`;
                        }
                        else if (types_1.isEnum(valueType)) {
                            return ts_poet_1.code `${from} as number`;
                        }
                        else {
                            const cstr = case_1.capitalize(types_1.basicTypeName(ctx, valueType).toCodeString());
                            return ts_poet_1.code `${cstr}(${from})`;
                        }
                    }
                    else if (types_1.isObjectId(valueType) && options.useMongoObjectId) {
                        return ts_poet_1.code `${utils.fromJsonObjectId}(${from})`;
                    }
                    else if (types_1.isTimestamp(valueType) && options.useDate === options_1.DateOption.STRING) {
                        return ts_poet_1.code `String(${from})`;
                    }
                    else if (types_1.isTimestamp(valueType) &&
                        (options.useDate === options_1.DateOption.DATE || options.useDate === options_1.DateOption.TIMESTAMP)) {
                        return ts_poet_1.code `${utils.fromJsonTimestamp}(${from})`;
                    }
                    else if (types_1.isValueType(ctx, valueType)) {
                        const type = types_1.basicTypeName(ctx, valueType);
                        return ts_poet_1.code `${from} as ${type}`;
                    }
                    else if (types_1.isAnyValueType(valueType)) {
                        return ts_poet_1.code `${from}`;
                    }
                    else {
                        const type = types_1.basicTypeName(ctx, valueType);
                        return ts_poet_1.code `${type}.fromJSON(${from})`;
                    }
                }
                else {
                    const type = types_1.basicTypeName(ctx, field);
                    return ts_poet_1.code `${type}.fromJSON(${from})`;
                }
            }
            else {
                throw new Error(`Unhandled field ${field}`);
            }
        };
        // and then use the snippet to handle repeated fields if necessary
        if (types_1.isRepeated(field)) {
            if (types_1.isMapType(ctx, messageDesc, field)) {
                const fieldType = types_1.toTypeName(ctx, messageDesc, field);
                const i = maybeCastToNumber(ctx, messageDesc, field, 'key');
                chunks.push(ts_poet_1.code `
          ${fieldName}: ${ctx.utils.isObject}(object.${jsonName})
            ? Object.entries(object.${jsonName}).reduce<${fieldType}>((acc, [key, value]) => {
                acc[${i}] = ${readSnippet('value')};
                return acc;
              }, {})
            : {},
        `);
            }
            else {
                const readValueSnippet = readSnippet('e');
                if (readValueSnippet.toString() === ts_poet_1.code `e`.toString()) {
                    chunks.push(ts_poet_1.code `${fieldName}: Array.isArray(object?.${jsonName}) ? [...object.${jsonName}] : [],`);
                }
                else {
                    // Explicit `any` type required to make TS with noImplicitAny happy. `object` is also `any` here.
                    chunks.push(ts_poet_1.code `
            ${fieldName}: Array.isArray(object?.${jsonName}) ? object.${jsonName}.map((e: any) => ${readValueSnippet}): [],
          `);
                }
            }
        }
        else if (types_1.isWithinOneOfThatShouldBeUnion(options, field)) {
            const cases = oneofFieldsCases[field.oneofIndex];
            const firstCase = cases[0];
            const lastCase = cases[cases.length - 1];
            if (field === firstCase) {
                const fieldName = case_1.maybeSnakeToCamel(messageDesc.oneofDecl[field.oneofIndex].name, options);
                chunks.push(ts_poet_1.code `${fieldName}: `);
            }
            const ternaryIf = ts_poet_1.code `${ctx.utils.isSet}(object.${jsonName})`;
            const ternaryThen = ts_poet_1.code `{ $case: '${fieldName}', ${fieldName}: ${readSnippet(`object.${jsonName}`)}`;
            chunks.push(ts_poet_1.code `${ternaryIf} ? ${ternaryThen}} : `);
            if (field === lastCase) {
                chunks.push(ts_poet_1.code `undefined,`);
            }
        }
        else if (types_1.isAnyValueType(field)) {
            chunks.push(ts_poet_1.code `${fieldName}: ${ctx.utils.isSet}(object?.${jsonName})
        ? ${readSnippet(`object.${jsonName}`)}
        : undefined,
      `);
        }
        else if (types_1.isStructType(field)) {
            chunks.push(ts_poet_1.code `${fieldName}: ${ctx.utils.isObject}(object.${jsonName})
          ? ${readSnippet(`object.${jsonName}`)}
          : undefined,`);
        }
        else if (types_1.isListValueType(field)) {
            chunks.push(ts_poet_1.code `
        ${fieldName}: Array.isArray(object.${jsonName})
          ? ${readSnippet(`object.${jsonName}`)}
          : undefined,
      `);
        }
        else {
            const fallback = types_1.isWithinOneOf(field) ? 'undefined' : types_1.defaultValue(ctx, field);
            chunks.push(ts_poet_1.code `
        ${fieldName}: ${ctx.utils.isSet}(object.${jsonName})
          ? ${readSnippet(`object.${jsonName}`)}
          : ${fallback},
      `);
        }
    });
    // and then wrap up the switch/while/return
    chunks.push(ts_poet_1.code `};`);
    chunks.push(ts_poet_1.code `}`);
    return ts_poet_1.joinCode(chunks, { on: '\n' });
}
function generateToJson(ctx, fullName, messageDesc) {
    const { options, utils, typeMap } = ctx;
    const chunks = [];
    // create the basic function declaration
    chunks.push(ts_poet_1.code `
    toJSON(${messageDesc.field.length > 0 ? 'message' : '_'}: ${fullName}): unknown {
      const obj: any = {};
  `);
    // then add a case for each field
    messageDesc.field.forEach((field) => {
        const fieldName = case_1.maybeSnakeToCamel(field.name, options);
        const jsonName = utils_1.determineFieldJsonName(field, options);
        const readSnippet = (from) => {
            if (types_1.isEnum(field)) {
                const toJson = types_1.getEnumMethod(ctx, field.typeName, 'ToJSON');
                return types_1.isWithinOneOf(field)
                    ? ts_poet_1.code `${from} !== undefined ? ${toJson}(${from}) : undefined`
                    : ts_poet_1.code `${toJson}(${from})`;
            }
            else if (types_1.isObjectId(field) && options.useMongoObjectId) {
                return ts_poet_1.code `${from}.toString()`;
            }
            else if (types_1.isTimestamp(field) && options.useDate === options_1.DateOption.DATE) {
                return ts_poet_1.code `${from}.toISOString()`;
            }
            else if (types_1.isTimestamp(field) && options.useDate === options_1.DateOption.STRING) {
                return ts_poet_1.code `${from}`;
            }
            else if (types_1.isTimestamp(field) && options.useDate === options_1.DateOption.TIMESTAMP) {
                return ts_poet_1.code `${utils.fromTimestamp}(${from}).toISOString()`;
            }
            else if (types_1.isMapType(ctx, messageDesc, field)) {
                // For map types, drill-in and then admittedly re-hard-code our per-value-type logic
                const valueType = typeMap.get(field.typeName)[2].field[1];
                if (types_1.isEnum(valueType)) {
                    const toJson = types_1.getEnumMethod(ctx, valueType.typeName, 'ToJSON');
                    return ts_poet_1.code `${toJson}(${from})`;
                }
                else if (types_1.isBytes(valueType)) {
                    return ts_poet_1.code `${utils.base64FromBytes}(${from})`;
                }
                else if (types_1.isObjectId(valueType) && options.useMongoObjectId) {
                    return ts_poet_1.code `${from}.toString()`;
                }
                else if (types_1.isTimestamp(valueType) && options.useDate === options_1.DateOption.DATE) {
                    return ts_poet_1.code `${from}.toISOString()`;
                }
                else if (types_1.isTimestamp(valueType) && options.useDate === options_1.DateOption.STRING) {
                    return ts_poet_1.code `${from}`;
                }
                else if (types_1.isTimestamp(valueType) && options.useDate === options_1.DateOption.TIMESTAMP) {
                    return ts_poet_1.code `${utils.fromTimestamp}(${from}).toISOString()`;
                }
                else if (types_1.isLong(valueType) && options.forceLong === options_1.LongOption.LONG) {
                    return ts_poet_1.code `${from}.toString()`;
                }
                else if (types_1.isWholeNumber(valueType) && !(types_1.isLong(valueType) && options.forceLong === options_1.LongOption.STRING)) {
                    return ts_poet_1.code `Math.round(${from})`;
                }
                else if (types_1.isScalar(valueType) || types_1.isValueType(ctx, valueType)) {
                    return ts_poet_1.code `${from}`;
                }
                else if (types_1.isAnyValueType(valueType)) {
                    return ts_poet_1.code `${from}`;
                }
                else {
                    const type = types_1.basicTypeName(ctx, valueType);
                    return ts_poet_1.code `${type}.toJSON(${from})`;
                }
            }
            else if (types_1.isAnyValueType(field)) {
                return ts_poet_1.code `${from}`;
            }
            else if (types_1.isFieldMaskType(field)) {
                return ts_poet_1.code `${from}.paths.join()`;
            }
            else if (types_1.isMessage(field) && !types_1.isValueType(ctx, field) && !types_1.isMapType(ctx, messageDesc, field)) {
                const type = types_1.basicTypeName(ctx, field, { keepValueType: true });
                return ts_poet_1.code `${from} ? ${type}.toJSON(${from}) : ${types_1.defaultValue(ctx, field)}`;
            }
            else if (types_1.isBytes(field)) {
                if (types_1.isWithinOneOf(field)) {
                    return ts_poet_1.code `${from} !== undefined ? ${utils.base64FromBytes}(${from}) : undefined`;
                }
                else {
                    return ts_poet_1.code `${utils.base64FromBytes}(${from} !== undefined ? ${from} : ${types_1.defaultValue(ctx, field)})`;
                }
            }
            else if (types_1.isLong(field) && options.forceLong === options_1.LongOption.LONG) {
                const v = types_1.isWithinOneOf(field) ? 'undefined' : types_1.defaultValue(ctx, field);
                return ts_poet_1.code `(${from} || ${v}).toString()`;
            }
            else if (types_1.isWholeNumber(field) && !(types_1.isLong(field) && options.forceLong === options_1.LongOption.STRING)) {
                return ts_poet_1.code `Math.round(${from})`;
            }
            else {
                return ts_poet_1.code `${from}`;
            }
        };
        if (types_1.isMapType(ctx, messageDesc, field)) {
            // Maps might need their values transformed, i.e. bytes --> base64
            chunks.push(ts_poet_1.code `
        obj.${jsonName} = {};
        if (message.${fieldName}) {
          Object.entries(message.${fieldName}).forEach(([k, v]) => {
            obj.${jsonName}[k] = ${readSnippet('v')};
          });
        }
      `);
        }
        else if (types_1.isRepeated(field)) {
            // Arrays might need their elements transformed
            chunks.push(ts_poet_1.code `
        if (message.${fieldName}) {
          obj.${jsonName} = message.${fieldName}.map(e => ${readSnippet('e')});
        } else {
          obj.${jsonName} = [];
        }
      `);
        }
        else if (types_1.isWithinOneOfThatShouldBeUnion(options, field)) {
            // oneofs in a union are only output as `oneof name = ...`
            const oneofName = case_1.maybeSnakeToCamel(messageDesc.oneofDecl[field.oneofIndex].name, options);
            const v = readSnippet(`message.${oneofName}?.${fieldName}`);
            chunks.push(ts_poet_1.code `message.${oneofName}?.$case === '${fieldName}' && (obj.${jsonName} = ${v});`);
        }
        else {
            const v = readSnippet(`message.${fieldName}`);
            chunks.push(ts_poet_1.code `message.${fieldName} !== undefined && (obj.${jsonName} = ${v});`);
        }
    });
    chunks.push(ts_poet_1.code `return obj;`);
    chunks.push(ts_poet_1.code `}`);
    return ts_poet_1.joinCode(chunks, { on: '\n' });
}
function generateFromPartial(ctx, fullName, messageDesc) {
    const { options, utils, typeMap } = ctx;
    const chunks = [];
    // create the basic function declaration
    const paramName = messageDesc.field.length > 0 ? 'object' : '_';
    if (ctx.options.useExactTypes) {
        chunks.push(ts_poet_1.code `
      fromPartial<I extends ${utils.Exact}<${utils.DeepPartial}<${fullName}>, I>>(${paramName}: I): ${fullName} {
    `);
    }
    else {
        chunks.push(ts_poet_1.code `
      fromPartial(${paramName}: ${utils.DeepPartial}<${fullName}>): ${fullName} {
    `);
    }
    let createBase = ts_poet_1.code `createBase${fullName}()`;
    if (options.usePrototypeForDefaults) {
        createBase = ts_poet_1.code `Object.create(${createBase}) as ${fullName}`;
    }
    chunks.push(ts_poet_1.code `const message = ${createBase};`);
    // add a check for each incoming field
    messageDesc.field.forEach((field) => {
        const fieldName = case_1.maybeSnakeToCamel(field.name, options);
        const readSnippet = (from) => {
            if ((types_1.isLong(field) || types_1.isLongValueType(field)) && options.forceLong === options_1.LongOption.LONG) {
                return ts_poet_1.code `Long.fromValue(${from})`;
            }
            else if (types_1.isObjectId(field) && options.useMongoObjectId) {
                return ts_poet_1.code `${from} as mongodb.ObjectId`;
            }
            else if (types_1.isPrimitive(field) ||
                (types_1.isTimestamp(field) && (options.useDate === options_1.DateOption.DATE || options.useDate === options_1.DateOption.STRING)) ||
                types_1.isValueType(ctx, field)) {
                return ts_poet_1.code `${from}`;
            }
            else if (types_1.isMessage(field)) {
                if (types_1.isRepeated(field) && types_1.isMapType(ctx, messageDesc, field)) {
                    const valueType = typeMap.get(field.typeName)[2].field[1];
                    if (types_1.isPrimitive(valueType)) {
                        if (types_1.isBytes(valueType)) {
                            return ts_poet_1.code `${from}`;
                        }
                        else if (types_1.isEnum(valueType)) {
                            return ts_poet_1.code `${from} as number`;
                        }
                        else if (types_1.isLong(valueType) && options.forceLong === options_1.LongOption.LONG) {
                            return ts_poet_1.code `Long.fromValue(${from})`;
                        }
                        else {
                            const cstr = case_1.capitalize(types_1.basicTypeName(ctx, valueType).toCodeString());
                            return ts_poet_1.code `${cstr}(${from})`;
                        }
                    }
                    else if (types_1.isAnyValueType(valueType)) {
                        return ts_poet_1.code `${from}`;
                    }
                    else if (types_1.isObjectId(valueType) && options.useMongoObjectId) {
                        return ts_poet_1.code `${from} as mongodb.ObjectId`;
                    }
                    else if (types_1.isTimestamp(valueType) &&
                        (options.useDate === options_1.DateOption.DATE || options.useDate === options_1.DateOption.STRING)) {
                        return ts_poet_1.code `${from}`;
                    }
                    else if (types_1.isValueType(ctx, valueType)) {
                        return ts_poet_1.code `${from}`;
                    }
                    else {
                        const type = types_1.basicTypeName(ctx, valueType);
                        return ts_poet_1.code `${type}.fromPartial(${from})`;
                    }
                }
                else if (types_1.isAnyValueType(field)) {
                    return ts_poet_1.code `${from}`;
                }
                else {
                    const type = types_1.basicTypeName(ctx, field);
                    return ts_poet_1.code `${type}.fromPartial(${from})`;
                }
            }
            else {
                throw new Error(`Unhandled field ${field}`);
            }
        };
        // and then use the snippet to handle repeated fields if necessary
        if (types_1.isRepeated(field)) {
            if (types_1.isMapType(ctx, messageDesc, field)) {
                const fieldType = types_1.toTypeName(ctx, messageDesc, field);
                const i = maybeCastToNumber(ctx, messageDesc, field, 'key');
                chunks.push(ts_poet_1.code `
          message.${fieldName} = Object.entries(object.${fieldName} ?? {}).reduce<${fieldType}>((acc, [key, value]) => {
            if (value !== undefined) {
              acc[${i}] = ${readSnippet('value')};
            }
            return acc;
          }, {});
        `);
            }
            else {
                chunks.push(ts_poet_1.code `
          message.${fieldName} = object.${fieldName}?.map((e) => ${readSnippet('e')}) || [];
        `);
            }
        }
        else if (types_1.isWithinOneOfThatShouldBeUnion(options, field)) {
            let oneofName = case_1.maybeSnakeToCamel(messageDesc.oneofDecl[field.oneofIndex].name, options);
            const v = readSnippet(`object.${oneofName}.${fieldName}`);
            chunks.push(ts_poet_1.code `
        if (
          object.${oneofName}?.$case === '${fieldName}'
          && object.${oneofName}?.${fieldName} !== undefined
          && object.${oneofName}?.${fieldName} !== null
        ) {
          message.${oneofName} = { $case: '${fieldName}', ${fieldName}: ${v} };
        }
      `);
        }
        else if (readSnippet(`x`).toCodeString() == 'x') {
            // An optimized case of the else below that works when `readSnippet` returns the plain input
            const fallback = types_1.isWithinOneOf(field) ? 'undefined' : types_1.defaultValue(ctx, field);
            chunks.push(ts_poet_1.code `message.${fieldName} = object.${fieldName} ?? ${fallback};`);
        }
        else {
            const fallback = types_1.isWithinOneOf(field) ? 'undefined' : types_1.defaultValue(ctx, field);
            chunks.push(ts_poet_1.code `
        message.${fieldName} = (object.${fieldName} !== undefined && object.${fieldName} !== null)
          ? ${readSnippet(`object.${fieldName}`)}
          : ${fallback};
      `);
        }
    });
    // and then wrap up the switch/while/return
    chunks.push(ts_poet_1.code `return message;`);
    chunks.push(ts_poet_1.code `}`);
    return ts_poet_1.joinCode(chunks, { on: '\n' });
}
function generateWrap(ctx, fullProtoTypeName) {
    const chunks = [];
    if (types_1.isStructTypeName(fullProtoTypeName)) {
        chunks.push(ts_poet_1.code `wrap(object: {[key: string]: any} | undefined): Struct {
      const struct = createBaseStruct();
      if (object !== undefined) {
        Object.keys(object).forEach(key => {
          struct.fields[key] = object[key];
        });
      }
      return struct;
    }`);
    }
    if (types_1.isAnyValueTypeName(fullProtoTypeName)) {
        if (ctx.options.oneof === options_1.OneofOption.UNIONS) {
            chunks.push(ts_poet_1.code `wrap(value: any): Value {
        const result = createBaseValue();

        if (value === null) {
          result.kind = {$case: 'nullValue', nullValue: NullValue.NULL_VALUE};
        } else if (typeof value === 'boolean') {
          result.kind = {$case: 'boolValue', boolValue: value};
        } else if (typeof value === 'number') {
          result.kind = {$case: 'numberValue', numberValue: value};
        } else if (typeof value === 'string') {
          result.kind = {$case: 'stringValue', stringValue: value};
        } else if (Array.isArray(value)) {
          result.kind = {$case: 'listValue', listValue: value};
        } else if (typeof value === 'object') {
          result.kind = {$case: 'structValue', structValue: value};
        } else if (typeof value !== 'undefined') {
          throw new Error('Unsupported any value type: ' + typeof value);
        }

        return result;
    }`);
        }
        else {
            chunks.push(ts_poet_1.code `wrap(value: any): Value {
        const result = createBaseValue();

        if (value === null) {
          result.nullValue = NullValue.NULL_VALUE;
        } else if (typeof value === 'boolean') {
          result.boolValue = value;
        } else if (typeof value === 'number') {
          result.numberValue = value;
        } else if (typeof value === 'string') {
          result.stringValue = value;
        } else if (Array.isArray(value)) {
          result.listValue = value;
        } else if (typeof value === 'object') {
          result.structValue = value;
        } else if (typeof value !== 'undefined') {
          throw new Error('Unsupported any value type: ' + typeof value);
        }

        return result;
    }`);
        }
    }
    if (types_1.isListValueTypeName(fullProtoTypeName)) {
        chunks.push(ts_poet_1.code `wrap(value: Array<any> | undefined): ListValue {
      const result = createBaseListValue();

      result.values = value ?? [];

      return result;
    }`);
    }
    return chunks;
}
function generateUnwrap(ctx, fullProtoTypeName) {
    const chunks = [];
    if (types_1.isStructTypeName(fullProtoTypeName)) {
        chunks.push(ts_poet_1.code `unwrap(message: Struct): {[key: string]: any} {
      const object: { [key: string]: any } = {};
      Object.keys(message.fields).forEach(key => {
        object[key] = message.fields[key];
      });
      return object;
    }`);
    }
    if (types_1.isAnyValueTypeName(fullProtoTypeName)) {
        if (ctx.options.oneof === options_1.OneofOption.UNIONS) {
            chunks.push(ts_poet_1.code `unwrap(message: Value): string | number | boolean | Object | null | Array<any> | undefined {
        if (message.kind?.$case === 'nullValue') {
          return null;
        } else if (message.kind?.$case === 'numberValue') {
          return message.kind?.numberValue;
        } else if (message.kind?.$case === 'stringValue') {
          return message.kind?.stringValue;
        } else if (message.kind?.$case === 'boolValue') {
          return message.kind?.boolValue;
        } else if (message.kind?.$case === 'structValue') {
          return message.kind?.structValue;
        } else if (message.kind?.$case === 'listValue') {
          return message.kind?.listValue;
        } else {
          return undefined;
        }
    }`);
        }
        else {
            chunks.push(ts_poet_1.code `unwrap(message: Value): string | number | boolean | Object | null | Array<any> | undefined {
      if (message?.stringValue !== undefined) {
        return message.stringValue;
      } else if (message?.numberValue !== undefined) {
        return message.numberValue;
      } else if (message?.boolValue !== undefined) {
        return message.boolValue;
      } else if (message?.structValue !== undefined) {
        return message.structValue;
      } else if (message?.listValue !== undefined) {
          return message.listValue;
      } else if (message?.nullValue !== undefined) {
        return null;
      }
      return undefined;
    }`);
        }
    }
    if (types_1.isListValueTypeName(fullProtoTypeName)) {
        chunks.push(ts_poet_1.code `unwrap(message: ListValue): Array<any> {
      return message.values;
    }`);
    }
    return chunks;
}
exports.contextTypeVar = 'Context extends DataLoaders';
function maybeCastToNumber(ctx, messageDesc, field, variableName) {
    const { keyType } = types_1.detectMapType(ctx, messageDesc, field);
    if (keyType.toCodeString() === 'string') {
        return variableName;
    }
    else {
        return `Number(${variableName})`;
    }
}