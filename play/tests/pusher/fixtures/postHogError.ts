export const sourceContextMarker = "synthetic-source-secret";

export function exceptionWithSourceContext(): Error {
    return new Error("Fixture error");
}
