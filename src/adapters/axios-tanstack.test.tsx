import { QueryClient } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { intercept } from "../api/intercept";
import AxiosTanstack, { apiClient } from "./axios-tanstack";

type Pokemon = {
  name: string;
};

beforeAll(() => {
  intercept.listen({
    origin: "https://pokeapi.co",
    onUnhandledRequest: "error",
    adapter: apiClient,
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
  // Ignore Chuck Norris API requests (component makes this call but tests don't care about it)
  // Must be in beforeEach since intercept.reset() clears handlers
  intercept.ignore(["https://api.chucknorris.io/jokes/random"]);
});

afterEach(() => {
  intercept.reset();
});

afterAll(() => {
  intercept.close();
});

describe("axios + TanStack Query integration", () => {
  /**
   * This function simulates how a typical React Query queryFn would handle axios requests.
   * It's the same pattern used in components with useQuery.
   */
  async function fetchPokemons(limit = 6): Promise<Pokemon[]> {
    try {
      const response = await apiClient.get(`/api/v2/pokemon?limit=${limit}`);
      return response.data.results;
    } catch (error) {
      let msg = "Failed to fetch Pokémon list";
      if (axios.isAxiosError(error) && error.response?.data?.message) {
        msg = error.response.data.message;
      }
      throw new Error(msg);
    }
  }

  describe("Error handling", () => {
    it("shows error message with 500 status", async () => {
      intercept.get("/api/v2/pokemon").reject({
        status: 500,
        body: { message: "Internal Server Error" },
      });

      render(<AxiosTanstack />);

      expect(
        await screen.findByText(/Internal Server Error/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Try again/i }),
      ).toBeInTheDocument();
    });

    it("shows error message with 404 status", async () => {
      intercept.get("/api/v2/pokemon").reject({
        status: 404,
        body: { message: "Not Found" },
      });

      render(<AxiosTanstack />);

      expect(await screen.findByText(/Not Found/)).toBeInTheDocument();
    });

    it("shows generic error message when no error body", async () => {
      intercept.get("/api/v2/pokemon").reject({
        status: 503,
      });

      render(<AxiosTanstack />);

      expect(
        await screen.findByText(/Failed to fetch Pokémon list/),
      ).toBeInTheDocument();
    });

    it("allows retry after error", async () => {
      intercept.get("/api/v2/pokemon").reject({
        status: 500,
        body: { message: "Server Error" },
      });

      render(<AxiosTanstack />);

      expect(await screen.findByText(/Server Error/)).toBeInTheDocument();

      // Setup successful response for retry
      intercept.get("/api/v2/pokemon").resolve({
        results: [
          { name: "bulbasaur" },
          { name: "ivysaur" },
          { name: "venusaur" },
          { name: "charmander" },
          { name: "charmeleon" },
          { name: "charizard" },
        ],
      });

      await userEvent.click(screen.getByRole("button", { name: /Try again/i }));

      expect(await screen.findAllByRole("listitem")).toHaveLength(6);
    });

    it("handles different HTTP error codes", async () => {
      intercept.get("/api/v2/pokemon").reject({
        status: 429,
        body: { message: "Too Many Requests" },
      });

      render(<AxiosTanstack />);

      expect(await screen.findByText(/Too Many Requests/)).toBeInTheDocument();
    });

    it("handles network timeout errors", async () => {
      intercept.get("/api/v2/pokemon").reject({
        status: 408,
        body: { message: "Request Timeout" },
      });

      render(<AxiosTanstack />);

      expect(await screen.findByText(/Request Timeout/)).toBeInTheDocument();
    });
  });

  describe("Error handling with intercept.reject()", () => {
    it("throws error with 500 status and custom message", async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      intercept.get("/api/v2/pokemon").reject({
        status: 500,
        body: { message: "Internal Server Error" },
      });

      await expect(
        queryClient.fetchQuery({
          queryKey: ["pokemons", 6],
          queryFn: () => fetchPokemons(6),
        }),
      ).rejects.toThrow("Internal Server Error");
    });

    it("throws error with 404 status and custom message", async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      intercept.get("/api/v2/pokemon").reject({
        status: 404,
        body: { message: "Not Found" },
      });

      await expect(
        queryClient.fetchQuery({
          queryKey: ["pokemons", 6],
          queryFn: () => fetchPokemons(6),
        }),
      ).rejects.toThrow("Not Found");
    });

    it("throws generic error message when no error body provided", async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      intercept.get("/api/v2/pokemon").reject({
        status: 503,
      });

      await expect(
        queryClient.fetchQuery({
          queryKey: ["pokemons", 6],
          queryFn: () => fetchPokemons(6),
        }),
      ).rejects.toThrow("Failed to fetch Pokémon list");
    });

    it("handles different HTTP error codes (429 Too Many Requests)", async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      intercept.get("/api/v2/pokemon").reject({
        status: 429,
        body: { message: "Too Many Requests" },
      });

      await expect(
        queryClient.fetchQuery({
          queryKey: ["pokemons", 6],
          queryFn: () => fetchPokemons(6),
        }),
      ).rejects.toThrow("Too Many Requests");
    });

    it("handles network timeout errors (408 Request Timeout)", async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      intercept.get("/api/v2/pokemon").reject({
        status: 408,
        body: { message: "Request Timeout" },
      });

      await expect(
        queryClient.fetchQuery({
          queryKey: ["pokemons", 6],
          queryFn: () => fetchPokemons(6),
        }),
      ).rejects.toThrow("Request Timeout");
    });

    it("axios receives proper AxiosError structure", async () => {
      intercept.get("/api/v2/pokemon").reject({
        status: 404,
        body: { message: "Not found", code: "POKEMON_NOT_FOUND" },
      });

      try {
        await apiClient.get("/api/v2/pokemon");
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(axios.isAxiosError(error)).toBe(true);
        if (axios.isAxiosError(error)) {
          expect(error.response).toBeDefined();
          expect(error.response?.status).toBe(404);
          expect(error.response?.data).toEqual({
            message: "Not found",
            code: "POKEMON_NOT_FOUND",
          });
        }
      }
    });

    it("works correctly with direct axios.get() call", async () => {
      intercept.get("/api/v2/pokemon").reject({
        status: 500,
        body: { error: "Server Error" },
      });

      await expect(apiClient.get("/api/v2/pokemon")).rejects.toMatchObject({
        isAxiosError: true,
        response: {
          status: 500,
          data: { error: "Server Error" },
        },
      });
    });

    it("allows subsequent successful requests after error", async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      // First request fails
      intercept.get("/api/v2/pokemon").reject({
        status: 500,
        body: { message: "Server Error" },
      });

      await expect(
        queryClient.fetchQuery({
          queryKey: ["pokemons", 6],
          queryFn: () => fetchPokemons(6),
        }),
      ).rejects.toThrow("Server Error");

      // Reset and setup successful response
      intercept.reset();
      intercept.get("/api/v2/pokemon").resolve({
        results: [
          { name: "bulbasaur" },
          { name: "ivysaur" },
          { name: "venusaur" },
          { name: "charmander" },
          { name: "charmeleon" },
          { name: "charizard" },
        ],
      });

      const data = await queryClient.fetchQuery({
        queryKey: ["pokemons", 6],
        queryFn: () => fetchPokemons(6),
      });

      expect(data).toBeDefined();
      expect(data).toHaveLength(6);
      expect(data[0]?.name).toBe("bulbasaur");
    });

    it("simulates React Query error state behavior", async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      // Setup error response
      intercept.get("/api/v2/pokemon").reject({
        status: 500,
        body: { message: "Internal Server Error" },
      });

      // Simulate what happens when React Query calls the queryFn
      let error: Error | undefined;
      try {
        await queryClient.fetchQuery({
          queryKey: ["pokemons", 6],
          queryFn: () => fetchPokemons(6),
        });
      } catch (e) {
        error = e as Error;
      }

      // Verify the error was caught and has the correct message
      expect(error).toBeDefined();
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toBe("Internal Server Error");

      // This demonstrates that React Query would receive this error
      // and set isError: true, error: Error("Internal Server Error")
    });
  });

  describe("Success handling with intercept.resolve()", () => {
    it("returns data successfully with 200 status", async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      intercept.get("/api/v2/pokemon").resolve({
        results: [{ name: "pikachu" }, { name: "raichu" }],
      });

      const data = await queryClient.fetchQuery({
        queryKey: ["pokemons", 2],
        queryFn: () => fetchPokemons(2),
      });

      expect(data).toBeDefined();
      expect(data).toHaveLength(2);
      expect(data[0]?.name).toBe("pikachu");
      expect(data[1]?.name).toBe("raichu");
    });

    it("simulates React Query success state behavior", async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      // Setup successful response
      intercept.get("/api/v2/pokemon").resolve({
        results: [
          { name: "bulbasaur" },
          { name: "ivysaur" },
          { name: "venusaur" },
        ],
      });

      // Simulate what happens when React Query calls the queryFn
      const data = await queryClient.fetchQuery({
        queryKey: ["pokemons", 3],
        queryFn: () => fetchPokemons(3),
      });

      // Verify the data was returned successfully
      expect(data).toBeDefined();
      expect(data).toHaveLength(3);
      expect(data[0]?.name).toBe("bulbasaur");

      // This demonstrates that React Query would receive this data
      // and set isSuccess: true, data: [{ name: "bulbasaur" }, ...]
    });
  });
});
