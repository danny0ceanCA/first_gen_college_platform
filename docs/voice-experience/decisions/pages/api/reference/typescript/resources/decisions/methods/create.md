## Create a decision

`client.decisions.create(DecisionCreateParamsbody, RequestOptionsoptions?): Decision`

**post** `/decisions`

Use this endpoint to quickly answer classification or scoring questions about some input. You can ask multiple questions in one request.

### Parameters

- `body: DecisionCreateParams`

  - `input: string | Array<DecisionInputUserMessage | DecisionInputDeveloperMessage | DecisionInputSystemMessage | 5 more>`

    The input to evaluate for every question. Provide a text string or an ordered array of messages, function calls and outputs, or custom tool calls and outputs. Each tool output must identify a matching call by call ID.

    - `string`

    - `Array<DecisionInputUserMessage | DecisionInputDeveloperMessage | DecisionInputSystemMessage | 5 more>`

      - `DecisionInputUserMessage`

        A user message containing input text, images, or JSON.

        - `content: string | Array<DecisionInputPart>`

          A text string or an ordered list of text, image, and JSON parts.

          - `string`

          - `Array<DecisionInputPart>`

            - `DecisionInputText`

              - `text: string`

                `minLength: 0`, `maxLength: 10485760`

              - `type: "input_text"`

                - `"input_text"`

              - `prompt_cache_breakpoint?: DecisionPromptCacheBreakpoint | null`

                Marks the exact end of a reusable prompt prefix. The breakpoint inherits its TTL from the request's `prompt_cache_options.ttl`; the boundary is not rounded to a token block.

                - `mode: "explicit"`

                  The breakpoint mode. Always `explicit`.

                  - `"explicit"`

            - `DecisionInputImage`

              An image provided as a base64 data URL or a publicly accessible HTTP(S) URL. File IDs are not supported.

              - `image_url: string`

                A base64-encoded image in a data URL or a publicly accessible HTTP(S) image URL.

                `minLength: 0`, `maxLength: 1073741824`

              - `type: "input_image"`

                - `"input_image"`

              - `detail?: "low" | "high" | "auto" | "original" | null`

                The image detail level, using the selected model's image profile. Defaults to auto.

                - `"low"`

                - `"high"`

                - `"auto"`

                - `"original"`

              - `prompt_cache_breakpoint?: DecisionPromptCacheBreakpoint | null`

                Marks the exact end of a reusable prompt prefix. The breakpoint inherits its TTL from the request's `prompt_cache_options.ttl`; the boundary is not rounded to a token block.

            - `DecisionInputJSON`

              A JSON object or an array of objects rendered as text. Nested values may be any JSON value. Limited to 32 container levels, 10,000 values, and 256 KiB of compact UTF-8 JSON.

              - `data: Record<string, unknown> | Array<Record<string, unknown>>`

                - `Record<string, unknown>`

                - `Array<Record<string, unknown>>`

              - `type: "input_json"`

                - `"input_json"`

        - `role: "user"`

          - `"user"`

        - `type?: "message"`

          - `"message"`

      - `DecisionInputDeveloperMessage`

        A developer message containing input text.

        - `content: string | Array<DecisionInputText>`

          A text string or an ordered list of input text parts.

          - `string`

          - `Array<DecisionInputText>`

            - `text: string`

              `minLength: 0`, `maxLength: 10485760`

            - `type: "input_text"`

            - `prompt_cache_breakpoint?: DecisionPromptCacheBreakpoint | null`

              Marks the exact end of a reusable prompt prefix. The breakpoint inherits its TTL from the request's `prompt_cache_options.ttl`; the boundary is not rounded to a token block.

        - `role: "developer"`

          - `"developer"`

        - `type?: "message"`

          - `"message"`

      - `DecisionInputSystemMessage`

        A system message containing input text.

        - `content: string | Array<DecisionInputText>`

          A text string or an ordered list of input text parts.

          - `string`

          - `Array<DecisionInputText>`

            - `text: string`

              `minLength: 0`, `maxLength: 10485760`

            - `type: "input_text"`

            - `prompt_cache_breakpoint?: DecisionPromptCacheBreakpoint | null`

              Marks the exact end of a reusable prompt prefix. The breakpoint inherits its TTL from the request's `prompt_cache_options.ttl`; the boundary is not rounded to a token block.

        - `role: "system"`

          - `"system"`

        - `type?: "message"`

          - `"message"`

      - `DecisionInputAssistantMessage`

        An assistant message containing output text or refusals.

        - `content: string | Array<DecisionInputOutputText | DecisionInputRefusal>`

          A text string or an ordered list of output text and refusal parts.

          - `string`

          - `Array<DecisionInputOutputText | DecisionInputRefusal>`

            - `DecisionInputOutputText`

              - `text: string`

                `minLength: 0`, `maxLength: 10485760`

              - `type: "output_text"`

                - `"output_text"`

            - `DecisionInputRefusal`

              - `refusal: string`

                `minLength: 0`, `maxLength: 10485760`

              - `type: "refusal"`

                - `"refusal"`

        - `role: "assistant"`

          - `"assistant"`

        - `phase?: "commentary" | "final_answer" | null`

          The phase of an assistant message.

          - `"commentary"`

          - `"final_answer"`

        - `type?: "message"`

          - `"message"`

      - `DecisionInputFunctionCall`

        - `arguments: string`

          `minLength: 0`, `maxLength: 1048576`

        - `call_id: string`

          `minLength: 1`, `maxLength: 64`

        - `name: string`

          `minLength: 1`, `maxLength: 128`

        - `type: "function_call"`

          - `"function_call"`

        - `id?: string | null`

          `minLength: 0`, `maxLength: 1048576`

        - `namespace?: string | null`

          `minLength: 1`, `maxLength: 64`

        - `status?: "in_progress" | "completed" | "incomplete" | null`

          - `"in_progress"`

          - `"completed"`

          - `"incomplete"`

      - `DecisionInputFunctionCallOutput`

        - `call_id: string`

          `minLength: 1`, `maxLength: 64`

        - `output: string | Array<DecisionInputText | DecisionInputImage>`

          Text evidence or an ordered list of text and image parts.

          - `string`

          - `Array<DecisionInputText | DecisionInputImage>`

            - `DecisionInputText`

            - `DecisionInputImage`

              An image provided as a base64 data URL or a publicly accessible HTTP(S) URL. File IDs are not supported.

        - `type: "function_call_output"`

          - `"function_call_output"`

        - `id?: string | null`

          `minLength: 0`, `maxLength: 1048576`

        - `status?: "in_progress" | "completed" | "incomplete" | null`

          - `"in_progress"`

          - `"completed"`

          - `"incomplete"`

      - `DecisionInputCustomToolCall`

        - `call_id: string`

          `minLength: 1`, `maxLength: 64`

        - `input: string`

          `minLength: 0`, `maxLength: 1048576`

        - `name: string`

          `minLength: 1`, `maxLength: 64`

        - `type: "custom_tool_call"`

          - `"custom_tool_call"`

        - `id?: string | null`

          `minLength: 0`, `maxLength: 1048576`

        - `namespace?: string | null`

          `minLength: 1`, `maxLength: 64`

        - `status?: "in_progress" | "completed" | "incomplete" | null`

          - `"in_progress"`

          - `"completed"`

          - `"incomplete"`

      - `DecisionInputCustomToolCallOutput`

        - `call_id: string`

          `minLength: 1`, `maxLength: 64`

        - `output: string | Array<DecisionInputText | DecisionInputImage>`

          Text evidence or an ordered list of text and image parts.

          - `string`

          - `Array<DecisionInputText | DecisionInputImage>`

            - `DecisionInputText`

            - `DecisionInputImage`

              An image provided as a base64 data URL or a publicly accessible HTTP(S) URL. File IDs are not supported.

        - `type: "custom_tool_call_output"`

          - `"custom_tool_call_output"`

        - `id?: string | null`

          `minLength: 0`, `maxLength: 1048576`

        - `status?: "in_progress" | "completed" | "incomplete" | null`

          - `"in_progress"`

          - `"completed"`

          - `"incomplete"`

  - `model: string`

    The model to use. Only `gpt-6-luna` is supported.

    `minLength: 0`, `maxLength: 1048576`

  - `questions: Array<QuestionParamPredicate | QuestionParamChoice | QuestionParamScore>`

    Ask 1–400 questions about the input. Each question can be a predicate, choice, or score. Answers come back in the same order.

    `minItems: 1`, `maxItems: 400`

    - `QuestionParamPredicate`

      Estimate how likely it is that a statement about the input is true.

      - `instructions: string | Array<DecisionQuestionInputPart>`

        - `string`

        - `Array<DecisionQuestionInputPart>`

          - `DecisionQuestionInputText`

            - `text: string`

              `minLength: 0`, `maxLength: 10485760`

            - `type: "input_text"`

              - `"input_text"`

          - `DecisionQuestionInputImage`

            An image provided as a base64 data URL or a publicly accessible HTTP(S) URL. File IDs are not supported.

            - `image_url: string`

              A base64-encoded image in a data URL or a publicly accessible HTTP(S) image URL.

              `minLength: 0`, `maxLength: 1073741824`

            - `type: "input_image"`

              - `"input_image"`

            - `detail?: "low" | "high" | "auto" | "original" | null`

              The image detail level, using the selected model's image profile. Defaults to auto.

              - `"low"`

              - `"high"`

              - `"auto"`

              - `"original"`

          - `DecisionInputJSON`

            A JSON object or an array of objects rendered as text. Nested values may be any JSON value. Limited to 32 container levels, 10,000 values, and 256 KiB of compact UTF-8 JSON.

      - `type: "predicate"`

        The type of the object. Always `predicate`.

        - `"predicate"`

      - `name?: string`

        `minLength: 0`, `maxLength: 1048576`

    - `QuestionParamChoice`

      Choose from the supplied options based on the input.

      - `choices: Array<Choice>`

        Provide between 2 and 255 choices. Each choice must be unique.

        `minItems: 2`, `maxItems: 255`

        - `value: string | boolean`

          Choice values are typed: a string and a boolean with the same text are distinct.

          - `string`

          - `boolean`

        - `description?: string`

          `minLength: 0`, `maxLength: 1048576`

      - `instructions: string | Array<DecisionQuestionInputPart>`

        - `string`

        - `Array<DecisionQuestionInputPart>`

          - `DecisionQuestionInputText`

          - `DecisionQuestionInputImage`

            An image provided as a base64 data URL or a publicly accessible HTTP(S) URL. File IDs are not supported.

          - `DecisionInputJSON`

            A JSON object or an array of objects rendered as text. Nested values may be any JSON value. Limited to 32 container levels, 10,000 values, and 256 KiB of compact UTF-8 JSON.

      - `type: "choice"`

        The type of the object. Always `choice`.

        - `"choice"`

      - `name?: string`

        `minLength: 0`, `maxLength: 1048576`

    - `QuestionParamScore`

      Rate the input against the supplied ordered levels.

      - `instructions: string | Array<DecisionQuestionInputPart>`

        - `string`

        - `Array<DecisionQuestionInputPart>`

          - `DecisionQuestionInputText`

          - `DecisionQuestionInputImage`

            An image provided as a base64 data URL or a publicly accessible HTTP(S) URL. File IDs are not supported.

          - `DecisionInputJSON`

            A JSON object or an array of objects rendered as text. Nested values may be any JSON value. Limited to 32 container levels, 10,000 values, and 256 KiB of compact UTF-8 JSON.

      - `levels: Array<Level>`

        `minItems: 2`, `maxItems: 10`

        - `label: string`

          `minLength: 0`, `maxLength: 1048576`

        - `description?: string`

          `minLength: 0`, `maxLength: 1048576`

      - `type: "score"`

        The type of the object. Always `score`.

        - `"score"`

      - `name?: string`

        `minLength: 0`, `maxLength: 1048576`

  - `prompt_cache_key?: string | null`

    Partition prompt cache reuse by caller-provided key.

    `minLength: 0`, `maxLength: 64`

  - `prompt_cache_options?: PromptCacheOptions | null`

    Options for prompt caching. Supported for `gpt-5.6` and later models. By default, OpenAI automatically chooses one implicit cache breakpoint. You can add explicit breakpoints to content blocks with `prompt_cache_breakpoint`. Each request can write up to four breakpoints. For cache matching, OpenAI considers up to the latest 80 breakpoints in the conversation, without a content-block lookback limit. Set `mode` to `explicit` to disable the implicit breakpoint. The `ttl` defaults to `30m`, which is currently the only supported value. See the [prompt caching guide](/api/docs/guides/prompt-caching) for current details.

    - `mode?: "implicit" | "explicit" | null`

      Controls whether OpenAI automatically creates an implicit cache breakpoint. Defaults to `implicit`. With `implicit`, OpenAI creates one implicit breakpoint and writes up to the latest three explicit breakpoints in the request. With `explicit`, OpenAI does not create an implicit breakpoint and writes up to the latest four explicit breakpoints. If there are no explicit breakpoints, the request does not use prompt caching.

      - `"implicit"`

      - `"explicit"`

    - `ttl?: "30m"`

      The minimum lifetime applied to every implicit and explicit cache breakpoint written by the request. Defaults to `30m`, which is currently the only supported value. The backend may retain cache entries for longer.

      - `"30m"`

  - `safety_identifier?: string | null`

    Opaque caller-provided end-user identifier, scoped by the verified org. Match Responses' limit; this is never the authenticated user identity.

    `minLength: 0`, `maxLength: 128`

### Returns

- `Decision`

  - `answers: Array<AnswerResourcePredicate | AnswerResourceChoice | AnswerResourceScore | AnswerResourceRefusal>`

    Answers in question order. Any question can return a refusal instead of an answer; other questions can still receive answers. A refusal has `type: "refusal"` and the question's `name`, or `null` if it was unnamed.

    `minItems: 0`, `maxItems: 2000`

    - `AnswerResourcePredicate`

      - `name: string | null`

        `minLength: 0`

      - `probability: number`

      - `type: "predicate"`

        The type of the object. Always `predicate`.

        - `"predicate"`

    - `AnswerResourceChoice`

      - `choice: string | boolean`

        Choice values are typed: a string and a boolean with the same text are distinct.

        - `string`

        - `boolean`

      - `confidence: number`

      - `name: string | null`

        `minLength: 0`

      - `probabilities: Array<Probability>`

        `minItems: 0`, `maxItems: 2000`

        - `probability: number`

        - `value: string | boolean`

          Choice values are typed: a string and a boolean with the same text are distinct.

          - `string`

          - `boolean`

      - `type: "choice"`

        The type of the object. Always `choice`.

        - `"choice"`

    - `AnswerResourceScore`

      - `confidence: number`

      - `name: string | null`

        `minLength: 0`

      - `probabilities: Array<Probability>`

        `minItems: 0`, `maxItems: 2000`

        - `label: string`

          `minLength: 0`

        - `probability: number`

        - `value: number`

          `format: int64`

      - `score: number`

      - `type: "score"`

        The type of the object. Always `score`.

        - `"score"`

    - `AnswerResourceRefusal`

      The model declined to answer this question. Other questions in the same request can still receive answers.

      - `name: string | null`

        `minLength: 0`

      - `type: "refusal"`

        The type of the object. Always `refusal`.

        - `"refusal"`

  - `model: string`

    The model used.

    `minLength: 0`

  - `usage: Usage`

    Token usage for the request.

    - `input_tokens: number`

      `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

    - `input_tokens_details: InputTokensDetails`

      - `cache_write_tokens: number`

        `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

      - `cached_tokens: number`

        `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

    - `output_tokens: number`

      `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

    - `output_tokens_details: OutputTokensDetails`

      - `reasoning_tokens: number`

        `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

    - `total_tokens: number`

      `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

### Example

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'], // This is the default and can be omitted
});

const decision = await client.decisions.create({
  input: 'string',
  model: 'model',
  questions: [{ instructions: 'string', type: 'predicate' }],
});

console.log(decision.answers);
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
