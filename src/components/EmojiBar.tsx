/** Safe emoji list — unicode escapes survive Windows/Linux transfers. */
const EMOJIS = [
  "\u{1F44D}", // thumbs up
  "\u{1F44E}", // thumbs down
  "\u{1F64F}", // pray
  "\u{2705}", // check
  "\u{1F525}", // fire
  "\u{1F4AF}", // 100
  "\u{1F389}", // party
  "\u{1F60A}", // smile
  "\u{1F622}", // cry
  "\u{1F914}", // think
  "\u{2764}\u{FE0F}", // heart
  "\u{1F44B}", // wave
  "\u{1F4AC}", // speech
  "\u{1F697}", // car
  "\u{1F527}", // wrench
  "\u{1F4B0}", // money bag
];

type Props = {
  onPick: (emoji: string) => void;
};

export function EmojiBar({ onPick }: Props) {
  return (
    <div className="emoji-bar">
      {EMOJIS.map((e) => (
        <button key={e} type="button" className="emoji-bar__btn" onClick={() => onPick(e)} title={e}>
          {e}
        </button>
      ))}
    </div>
  );
}
