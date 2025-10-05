import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import axios from "axios";

type Pokemon = {
  name: string;
};

type ChuckNorrisJoke = { id: string; value: string };

const limit = 6;

// Create axios instance with baseURL for the PokeAPI
export const apiClient = axios.create({
  baseURL: "https://pokeapi.co",
});

// Fetch Pokémons from the public PokeAPI using axios
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

async function fetchChuckNorrisJokes(): Promise<ChuckNorrisJoke[]> {
  const res = await fetch("https://api.chucknorris.io/jokes/random");
  if (!res.ok) {
    let msg = "Failed to fetch Chuck Norris joke";
    try {
      const err = await res.json();
      if (err?.message) {
        msg = err.message;
      }
    } catch {}
    throw new Error(msg);
  }
  const data = await res.json();
  return data;
}

const ListOfPokemons = () => {
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["pokemons", limit],
    queryFn: () => fetchPokemons(limit),
  });

  useQuery({
    queryKey: ["chuck_norris_joke", limit],
    queryFn: () => fetchChuckNorrisJokes(),
  });

  return (
    <div className="mt-8 w-full max-w-xl px-4">
      <h2 className="text-2xl mb-4">{`Pokémon (${limit})`}</h2>

      {isPending && <p>Loading Pokémon…</p>}

      {isError && (
        <div className="text-red-300">
          <p>
            Oops!{" "}
            {error instanceof Error ? error.message : "Something went wrong."}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-2 px-3 py-1 rounded bg-white/10 hover:bg-white/20"
          >
            Try again
          </button>
        </div>
      )}

      {data && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-base">
          {data.map((p) => (
            <li
              key={p.name}
              className="rounded-2xl p-4 bg-white/5 border border-white/10 flex items-center gap-4"
            >
              <div className="text-left">
                <div className="font-semibold capitalize">{p.name}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {isFetching && !isPending && (
        <p className="mt-2 opacity-80">Refreshing…</p>
      )}
    </div>
  );
};

export default function AxiosTanstack() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <ListOfPokemons />
    </QueryClientProvider>
  );
}
