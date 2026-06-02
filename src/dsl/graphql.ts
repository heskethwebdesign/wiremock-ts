import {
    containing,
    equalToJson,
    post,
    postRequestedFor,
    urlPathEqualTo,
    type MappingBuilder,
    type RequestPatternBuilder,
} from "./builders";

export interface GraphQlMatchOptions {
    // path the graphql endpoint is served on (defaults to "/graphql").
    path?: string;
    // when set, also require the query string to contain this text.
    queryContains?: string;
}

const GRAPHQL_PATH = "/graphql";

// graphql requests post `{ query, operationName, variables }`. matching the
// operationName (ignoring the rest of the body) is enough to route a stub,
// with an optional substring check against the query for finer control.
export const graphQlRequest = (
    operationName: string,
    options: GraphQlMatchOptions = {},
): MappingBuilder => {
    const builder = post(urlPathEqualTo(options.path ?? GRAPHQL_PATH)).withRequestBody(
        equalToJson({ operationName }, { ignoreExtraElements: true }),
    );
    if (options.queryContains !== undefined)
        builder.withRequestBody(containing(options.queryContains));
    return builder;
};

// the verification counterpart to `graphQlRequest`, for `verify`/`findRequests`.
export const graphQlRequestedFor = (
    operationName: string,
    options: GraphQlMatchOptions = {},
): RequestPatternBuilder => {
    const builder = postRequestedFor(urlPathEqualTo(options.path ?? GRAPHQL_PATH)).withRequestBody(
        equalToJson({ operationName }, { ignoreExtraElements: true }),
    );
    if (options.queryContains !== undefined)
        builder.withRequestBody(containing(options.queryContains));
    return builder;
};
