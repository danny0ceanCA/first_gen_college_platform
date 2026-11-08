## Create a decision

`decisions.create(DecisionCreateParams**kwargs)  -> Decision`

**post** `/decisions`

Use this endpoint to quickly answer classification or scoring questions about some input. You can ask multiple questions in one request.

### Parameters

- `input: Union[str, Iterable[InputUnionMember1]]`

  The input to evaluate for every question. Provide a text string or an ordered array of messages, function calls and outputs, or custom tool calls and outputs. Each tool output must identify a matching call by call ID.

  - `str`

  - `Iterable[InputUnionMember1]`

    - `class InputUnionMember1DecisionInputUserMessage: …`

      A user message containing input text, images, or JSON.

      - `content: Union[str, Iterable[DecisionInputPartParam]]`

        A text string or an ordered list of text, image, and JSON parts.

        - `str`

        - `Iterable[DecisionInputPartParam]`

          - `class DecisionInputText: …`

            - `text: str`

              `minLength: 0`, `maxLength: 10485760`

            - `type: Literal["input_text"]`

              - `"input_text"`

            - `prompt_cache_breakpoint: Optional[DecisionPromptCacheBreakpoint]`

              Marks the exact end of a reusable prompt prefix. The breakpoint inherits its TTL from the request's `prompt_cache_options.ttl`; the boundary is not rounded to a token block.

              - `mode: Literal["explicit"]`

                The breakpoint mode. Always `explicit`.

                - `"explicit"`

          - `class DecisionInputImage: …`

            An image provided as a base64 data URL or a publicly accessible HTTP(S) URL. File IDs are not supported.

            - `image_url: str`

              A base64-encoded image in a data URL or a publicly accessible HTTP(S) image URL.

              `minLength: 0`, `maxLength: 1073741824`

            - `type: Literal["input_image"]`

              - `"input_image"`

            - `detail: Optional[Literal["low", "high", "auto", "original"]]`

              The image detail level, using the selected model's image profile. Defaults to auto.

              - `"low"`

              - `"high"`

              - `"auto"`

              - `"original"`

            - `prompt_cache_breakpoint: Optional[DecisionPromptCacheBreakpoint]`

              Marks the exact end of a reusable prompt prefix. The breakpoint inherits its TTL from the request's `prompt_cache_options.ttl`; the boundary is not rounded to a token block.

          - `class DecisionInputJSON: …`

            A JSON object or an array of objects rendered as text. Nested values may be any JSON value. Limited to 32 container levels, 10,000 values, and 256 KiB of compact UTF-8 JSON.

            - `data: Union[Dict[str, Optional[object]], List[Dict[str, Optional[object]]]]`

              - `Dict[str, Optional[object]]`

              - `List[Dict[str, Optional[object]]]`

            - `type: Literal["input_json"]`

              - `"input_json"`

      - `role: Literal["user"]`

        - `"user"`

      - `type: Optional[Literal["message"]]`

        - `"message"`

    - `class InputUnionMember1DecisionInputDeveloperMessage: …`

      A developer message containing input text.

      - `content: Union[str, Iterable[DecisionInputTextParam]]`

        A text string or an ordered list of input text parts.

        - `str`

        - `Iterable[DecisionInputTextParam]`

          - `text: str`

            `minLength: 0`, `maxLength: 10485760`

          - `type: Literal["input_text"]`

          - `prompt_cache_breakpoint: Optional[DecisionPromptCacheBreakpoint]`

            Marks the exact end of a reusable prompt prefix. The breakpoint inherits its TTL from the request's `prompt_cache_options.ttl`; the boundary is not rounded to a token block.

      - `role: Literal["developer"]`

        - `"developer"`

      - `type: Optional[Literal["message"]]`

        - `"message"`

    - `class InputUnionMember1DecisionInputSystemMessage: …`

      A system message containing input text.

      - `content: Union[str, Iterable[DecisionInputTextParam]]`

        A text string or an ordered list of input text parts.

        - `str`

        - `Iterable[DecisionInputTextParam]`

          - `text: str`

            `minLength: 0`, `maxLength: 10485760`

          - `type: Literal["input_text"]`

          - `prompt_cache_breakpoint: Optional[DecisionPromptCacheBreakpoint]`

            Marks the exact end of a reusable prompt prefix. The breakpoint inherits its TTL from the request's `prompt_cache_options.ttl`; the boundary is not rounded to a token block.

      - `role: Literal["system"]`

        - `"system"`

      - `type: Optional[Literal["message"]]`

        - `"message"`

    - `class InputUnionMember1DecisionInputAssistantMessage: …`

      An assistant message containing output text or refusals.

      - `content: Union[str, Iterable[InputDecisionInputAssistantMessageContentDecisionInputAssistantContentParts]]`

        A text string or an ordered list of output text and refusal parts.

        - `str`

        - `Iterable[InputDecisionInputAssistantMessageContentDecisionInputAssistantContentParts]`

          - `class InputDecisionInputAssistantMessageContentDecisionInputAssistantContentPartDecisionInputOutputText: …`

            - `text: str`

              `minLength: 0`, `maxLength: 10485760`

            - `type: Literal["output_text"]`

              - `"output_text"`

          - `class InputDecisionInputAssistantMessageContentDecisionInputAssistantContentPartDecisionInputRefusal: …`

            - `refusal: str`

              `minLength: 0`, `maxLength: 10485760`

            - `type: Literal["refusal"]`

              - `"refusal"`

      - `role: Literal["assistant"]`

        - `"assistant"`

      - `phase: Optional[Literal["commentary", "final_answer"]]`

        The phase of an assistant message.

        - `"commentary"`

        - `"final_answer"`

      - `type: Optional[Literal["message"]]`

        - `"message"`

    - `class InputUnionMember1DecisionInputFunctionCall: …`

      - `arguments: str`

        `minLength: 0`, `maxLength: 1048576`

      - `call_id: str`

        `minLength: 1`, `maxLength: 64`

      - `name: str`

        `minLength: 1`, `maxLength: 128`

      - `type: Literal["function_call"]`

        - `"function_call"`

      - `id: Optional[str]`

        `minLength: 0`, `maxLength: 1048576`

      - `namespace: Optional[str]`

        `minLength: 1`, `maxLength: 64`

      - `status: Optional[Literal["in_progress", "completed", "incomplete"]]`

        - `"in_progress"`

        - `"completed"`

        - `"incomplete"`

    - `class InputUnionMember1DecisionInputFunctionCallOutput: …`

      - `call_id: str`

        `minLength: 1`, `maxLength: 64`

      - `output: Union[str, Iterable[InputUnionMember1FunctionCallOutputOutputParts]]`

        Text evidence or an ordered list of text and image parts.

        - `str`

        - `Iterable[InputUnionMember1FunctionCallOutputOutputParts]`

          - `class DecisionInputText: …`

          - `class DecisionInputImage: …`

            An image provided as a base64 data URL or a publicly accessible HTTP(S) URL. File IDs are not supported.

      - `type: Literal["function_call_output"]`

        - `"function_call_output"`

      - `id: Optional[str]`

        `minLength: 0`, `maxLength: 1048576`

      - `status: Optional[Literal["in_progress", "completed", "incomplete"]]`

        - `"in_progress"`

        - `"completed"`

        - `"incomplete"`

    - `class InputUnionMember1DecisionInputCustomToolCall: …`

      - `call_id: str`

        `minLength: 1`, `maxLength: 64`

      - `input: str`

        `minLength: 0`, `maxLength: 1048576`

      - `name: str`

        `minLength: 1`, `maxLength: 64`

      - `type: Literal["custom_tool_call"]`

        - `"custom_tool_call"`

      - `id: Optional[str]`

        `minLength: 0`, `maxLength: 1048576`

      - `namespace: Optional[str]`

        `minLength: 1`, `maxLength: 64`

      - `status: Optional[Literal["in_progress", "completed", "incomplete"]]`

        - `"in_progress"`

        - `"completed"`

        - `"incomplete"`

    - `class InputUnionMember1DecisionInputCustomToolCallOutput: …`

      - `call_id: str`

        `minLength: 1`, `maxLength: 64`

      - `output: Union[str, Iterable[InputUnionMember1CustomToolCallOutputOutputParts]]`

        Text evidence or an ordered list of text and image parts.

        - `str`

        - `Iterable[InputUnionMember1CustomToolCallOutputOutputParts]`

          - `class DecisionInputText: …`

          - `class DecisionInputImage: …`

            An image provided as a base64 data URL or a publicly accessible HTTP(S) URL. File IDs are not supported.

      - `type: Literal["custom_tool_call_output"]`

        - `"custom_tool_call_output"`

      - `id: Optional[str]`

        `minLength: 0`, `maxLength: 1048576`

      - `status: Optional[Literal["in_progress", "completed", "incomplete"]]`

        - `"in_progress"`

        - `"completed"`

        - `"incomplete"`

- `model: str`

  The model to use. Only `gpt-6-luna` is supported.

  `minLength: 0`, `maxLength: 1048576`

- `questions: Iterable[Question]`

  Ask 1–400 questions about the input. Each question can be a predicate, choice, or score. Answers come back in the same order.

  `minItems: 1`, `maxItems: 400`

  - `class QuestionQuestionParamPredicate: …`

    Estimate how likely it is that a statement about the input is true.

    - `instructions: Union[str, Iterable[DecisionQuestionInputPart]]`

      - `str`

      - `Iterable[DecisionQuestionInputPart]`

        - `class DecisionQuestionInputText: …`

          - `text: str`

            `minLength: 0`, `maxLength: 10485760`

          - `type: Literal["input_text"]`

            - `"input_text"`

        - `class DecisionQuestionInputImage: …`

          An image provided as a base64 data URL or a publicly accessible HTTP(S) URL. File IDs are not supported.

          - `image_url: str`

            A base64-encoded image in a data URL or a publicly accessible HTTP(S) image URL.

            `minLength: 0`, `maxLength: 1073741824`

          - `type: Literal["input_image"]`

            - `"input_image"`

          - `detail: Optional[Literal["low", "high", "auto", "original"]]`

            The image detail level, using the selected model's image profile. Defaults to auto.

            - `"low"`

            - `"high"`

            - `"auto"`

            - `"original"`

        - `class DecisionInputJSON: …`

          A JSON object or an array of objects rendered as text. Nested values may be any JSON value. Limited to 32 container levels, 10,000 values, and 256 KiB of compact UTF-8 JSON.

    - `type: Literal["predicate"]`

      The type of the object. Always `predicate`.

      - `"predicate"`

    - `name: Optional[str]`

      `minLength: 0`, `maxLength: 1048576`

  - `class QuestionQuestionParamChoice: …`

    Choose from the supplied options based on the input.

    - `choices: Iterable[QuestionQuestionParamChoiceChoice]`

      Provide between 2 and 255 choices. Each choice must be unique.

      `minItems: 2`, `maxItems: 255`

      - `value: Union[str, bool]`

        Choice values are typed: a string and a boolean with the same text are distinct.

        - `str`

        - `bool`

      - `description: Optional[str]`

        `minLength: 0`, `maxLength: 1048576`

    - `instructions: Union[str, Iterable[DecisionQuestionInputPart]]`

      - `str`

      - `Iterable[DecisionQuestionInputPart]`

        - `class DecisionQuestionInputText: …`

        - `class DecisionQuestionInputImage: …`

          An image provided as a base64 data URL or a publicly accessible HTTP(S) URL. File IDs are not supported.

        - `class DecisionInputJSON: …`

          A JSON object or an array of objects rendered as text. Nested values may be any JSON value. Limited to 32 container levels, 10,000 values, and 256 KiB of compact UTF-8 JSON.

    - `type: Literal["choice"]`

      The type of the object. Always `choice`.

      - `"choice"`

    - `name: Optional[str]`

      `minLength: 0`, `maxLength: 1048576`

  - `class QuestionQuestionParamScore: …`

    Rate the input against the supplied ordered levels.

    - `instructions: Union[str, Iterable[DecisionQuestionInputPart]]`

      - `str`

      - `Iterable[DecisionQuestionInputPart]`

        - `class DecisionQuestionInputText: …`

        - `class DecisionQuestionInputImage: …`

          An image provided as a base64 data URL or a publicly accessible HTTP(S) URL. File IDs are not supported.

        - `class DecisionInputJSON: …`

          A JSON object or an array of objects rendered as text. Nested values may be any JSON value. Limited to 32 container levels, 10,000 values, and 256 KiB of compact UTF-8 JSON.

    - `levels: Iterable[QuestionQuestionParamScoreLevel]`

      `minItems: 2`, `maxItems: 10`

      - `label: str`

        `minLength: 0`, `maxLength: 1048576`

      - `description: Optional[str]`

        `minLength: 0`, `maxLength: 1048576`

    - `type: Literal["score"]`

      The type of the object. Always `score`.

      - `"score"`

    - `name: Optional[str]`

      `minLength: 0`, `maxLength: 1048576`

- `prompt_cache_key: Optional[str]`

  Partition prompt cache reuse by caller-provided key.

  `minLength: 0`, `maxLength: 64`

- `prompt_cache_options: Optional[PromptCacheOptions]`

  Options for prompt caching. Supported for `gpt-5.6` and later models. By default, OpenAI automatically chooses one implicit cache breakpoint. You can add explicit breakpoints to content blocks with `prompt_cache_breakpoint`. Each request can write up to four breakpoints. For cache matching, OpenAI considers up to the latest 80 breakpoints in the conversation, without a content-block lookback limit. Set `mode` to `explicit` to disable the implicit breakpoint. The `ttl` defaults to `30m`, which is currently the only supported value. See the [prompt caching guide](/api/docs/guides/prompt-caching) for current details.

  - `mode: Optional[Literal["implicit", "explicit"]]`

    Controls whether OpenAI automatically creates an implicit cache breakpoint. Defaults to `implicit`. With `implicit`, OpenAI creates one implicit breakpoint and writes up to the latest three explicit breakpoints in the request. With `explicit`, OpenAI does not create an implicit breakpoint and writes up to the latest four explicit breakpoints. If there are no explicit breakpoints, the request does not use prompt caching.

    - `"implicit"`

    - `"explicit"`

  - `ttl: Optional[Literal["30m"]]`

    The minimum lifetime applied to every implicit and explicit cache breakpoint written by the request. Defaults to `30m`, which is currently the only supported value. The backend may retain cache entries for longer.

    - `"30m"`

- `safety_identifier: Optional[str]`

  Opaque caller-provided end-user identifier, scoped by the verified org. Match Responses' limit; this is never the authenticated user identity.

  `minLength: 0`, `maxLength: 128`

### Returns

- `class Decision: …`

  - `answers: List[Answer]`

    Answers in question order. Any question can return a refusal instead of an answer; other questions can still receive answers. A refusal has `type: "refusal"` and the question's `name`, or `null` if it was unnamed.

    `minItems: 0`, `maxItems: 2000`

    - `class AnswerAnswerResourcePredicate: …`

      - `name: Optional[str]`

        `minLength: 0`

      - `probability: float`

      - `type: Literal["predicate"]`

        The type of the object. Always `predicate`.

        - `"predicate"`

    - `class AnswerAnswerResourceChoice: …`

      - `choice: Union[str, bool]`

        Choice values are typed: a string and a boolean with the same text are distinct.

        - `str`

        - `bool`

      - `confidence: float`

      - `name: Optional[str]`

        `minLength: 0`

      - `probabilities: List[AnswerAnswerResourceChoiceProbability]`

        `minItems: 0`, `maxItems: 2000`

        - `probability: float`

        - `value: Union[str, bool]`

          Choice values are typed: a string and a boolean with the same text are distinct.

          - `str`

          - `bool`

      - `type: Literal["choice"]`

        The type of the object. Always `choice`.

        - `"choice"`

    - `class AnswerAnswerResourceScore: …`

      - `confidence: float`

      - `name: Optional[str]`

        `minLength: 0`

      - `probabilities: List[AnswerAnswerResourceScoreProbability]`

        `minItems: 0`, `maxItems: 2000`

        - `label: str`

          `minLength: 0`

        - `probability: float`

        - `value: int`

          `format: int64`

      - `score: float`

      - `type: Literal["score"]`

        The type of the object. Always `score`.

        - `"score"`

    - `class AnswerAnswerResourceRefusal: …`

      The model declined to answer this question. Other questions in the same request can still receive answers.

      - `name: Optional[str]`

        `minLength: 0`

      - `type: Literal["refusal"]`

        The type of the object. Always `refusal`.

        - `"refusal"`

  - `model: str`

    The model used.

    `minLength: 0`

  - `usage: Usage`

    Token usage for the request.

    - `input_tokens: int`

      `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

    - `input_tokens_details: UsageInputTokensDetails`

      - `cache_write_tokens: int`

        `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

      - `cached_tokens: int`

        `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

    - `output_tokens: int`

      `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

    - `output_tokens_details: UsageOutputTokensDetails`

      - `reasoning_tokens: int`

        `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

    - `total_tokens: int`

      `format: int64`, `minimum: -2147483648`, `maximum: 2147483647`

### Example

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("OPENAI_API_KEY"),  # This is the default and can be omitted
)
decision = client.decisions.create(
    input="string",
    model="model",
    questions=[{
        "instructions": "string",
        "type": "predicate",
    }],
)
print(decision.answers)
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
