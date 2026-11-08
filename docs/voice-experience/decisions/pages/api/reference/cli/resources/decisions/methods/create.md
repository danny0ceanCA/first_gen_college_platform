## Create a decision

`$ openai decisions create`

**post** `/decisions`

Use this endpoint to quickly answer classification or scoring questions about some input. You can ask multiple questions in one request.

### Parameters

- `--input: string or array of unknown`

  The input to evaluate for every question. Provide a text string or an ordered array of messages, function calls and outputs, or custom tool calls and outputs. Each tool output must identify a matching call by call ID.

- `--model: string`

  The model to use. Only `gpt-6-luna` is supported.

  `minLength: 0`, `maxLength: 1048576`

- `--question: array of object { instructions, type, name }  or object { choices, instructions, type, name }  or object { instructions, levels, type, name }`

  Ask 1–400 questions about the input. Each question can be a predicate, choice, or score. Answers come back in the same order.

  `minItems: 1`, `maxItems: 400`

- `--prompt-cache-key: optional string`

  Partition prompt cache reuse by caller-provided key.

  `minLength: 0`, `maxLength: 64`

- `--prompt-cache-options: optional object { mode, ttl }`

  Options for prompt caching. Supported for `gpt-5.6` and later models. By default, OpenAI automatically chooses one implicit cache breakpoint. You can add explicit breakpoints to content blocks with `prompt_cache_breakpoint`. Each request can write up to four breakpoints. For cache matching, OpenAI considers up to the latest 80 breakpoints in the conversation, without a content-block lookback limit. Set `mode` to `explicit` to disable the implicit breakpoint. The `ttl` defaults to `30m`, which is currently the only supported value. See the [prompt caching guide](/api/docs/guides/prompt-caching) for current details.

- `--safety-identifier: optional string`

  Opaque caller-provided end-user identifier, scoped by the verified org. Match Responses' limit; this is never the authenticated user identity.

  `minLength: 0`, `maxLength: 128`

### Returns

- `decision: object { answers, model, usage }`

  - `answers: array of object { name, probability, type }  or object { choice, confidence, name, 2 more }  or object { confidence, name, probabilities, 2 more }  or object { name, type }`

    Answers in question order. Any question can return a refusal instead of an answer; other questions can still receive answers. A refusal has `type: "refusal"` and the question's `name`, or `null` if it was unnamed.

    `minItems: 0`, `maxItems: 2000`

    - `predicate: object { name, probability, type }`

      - `name: string`

        `minLength: 0`

      - `probability: number`

      - `type: "predicate"`

        The type of the object. Always `predicate`.

    - `choice: object { choice, confidence, name, 2 more }`

      - `choice: string or boolean`

        Choice values are typed: a string and a boolean with the same text are distinct.

        - `union_member_0: string`

        - `union_member_1: boolean`

      - `confidence: number`

      - `name: string`

        `minLength: 0`

      - `probabilities: array of object { probability, value }`

        `minItems: 0`, `maxItems: 2000`

        - `probability: number`

        - `value: string or boolean`

          Choice values are typed: a string and a boolean with the same text are distinct.

          - `union_member_0: string`

          - `union_member_1: boolean`

      - `type: "choice"`

        The type of the object. Always `choice`.

    - `score: object { confidence, name, probabilities, 2 more }`

      - `confidence: number`

      - `name: string`

        `minLength: 0`

      - `probabilities: array of object { label, probability, value }`

        `minItems: 0`, `maxItems: 2000`

        - `label: string`

          `minLength: 0`

        - `probability: number`

        - `value: number`

          `format: int64`

      - `score: number`

      - `type: "score"`

        The type of the object. Always `score`.

    - `refusal: object { name, type }`

      The model declined to answer this question. Other questions in the same request can still receive answers.

      - `name: string`

        `minLength: 0`

      - `type: "refusal"`

        The type of the object. Always `refusal`.

  - `model: string`

    The model used.

    `minLength: 0`

  - `usage: object { input_tokens, input_tokens_details, output_tokens, 2 more }`

    Token usage for the request.

    - `input_tokens: number`

      `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

    - `input_tokens_details: object { cache_write_tokens, cached_tokens }`

      - `cache_write_tokens: number`

        `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

      - `cached_tokens: number`

        `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

    - `output_tokens: number`

      `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

    - `output_tokens_details: object { reasoning_tokens }`

      - `reasoning_tokens: number`

        `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

    - `total_tokens: number`

      `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

### Example

```cli
openai decisions create \
  --api-key 'My API Key' \
  --input string \
  --model model \
  --question '{instructions: string, type: predicate}'
```

#### 200 — Example

```json
{
  "answers": [
    {
      "name": "name",
      "probability": 0,
      "type": "predicate"
    }
  ],
  "model": "model",
  "usage": {
    "input_tokens": -2147483648,
    "input_tokens_details": {
      "cache_write_tokens": -2147483648,
      "cached_tokens": -2147483648
    },
    "output_tokens": -2147483648,
    "output_tokens_details": {
      "reasoning_tokens": -2147483648
    },
    "total_tokens": -2147483648
  }
}
```
