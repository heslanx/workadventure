import { describe, expect, it } from "vitest";
import { EnvironmentVariables } from "../src/Enum/EnvironmentVariableValidator";

describe("EnvironmentVariable", () => {
    it("should validate properly URLs", () => {
        let result = EnvironmentVariables.safeParse({
            PLAY_URL: "https://example.com",
        });
        expect(result.success).toBe(true);

        result = EnvironmentVariables.safeParse({
            PLAY_URL: "https://12.12.12.12",
        });
        expect(result.success).toBe(true);

        result = EnvironmentVariables.safeParse({
            PLAY_URL: "https://12.12.12.12",
            ADMIN_API_URL: "",
        });
        expect(result.success).toBe(true);
    });

    describe("MAX_P2P_PEERS", () => {
        const parse = (MAX_P2P_PEERS?: string) =>
            EnvironmentVariables.safeParse({ PLAY_URL: "https://example.com", MAX_P2P_PEERS });

        it.each([undefined, ""])("is unlimited when it is %j", (value) => {
            const result = parse(value);

            expect(result.success).toBe(true);
            expect(result.data?.MAX_P2P_PEERS).toBeUndefined();
        });

        it("is the number it is set to", () => {
            const result = parse("3");

            expect(result.success).toBe(true);
            expect(result.data?.MAX_P2P_PEERS).toBe(3);
        });

        it.each(["0", "-1", "1.5", "three"])("refuses %j rather than pairing nobody or guessing", (value) => {
            expect(parse(value).success).toBe(false);
        });
    });
});
