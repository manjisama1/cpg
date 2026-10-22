import { Lock } from 'lucide-react';
import { Avatar } from './Avatar';
import { CHARACTERS, characterName } from '../characters';

/** Grid of the ten characters. `taken` ones are greyed out and can't be chosen. */
export function CharacterPicker({ value, taken, onChange, disabled }: {
  value: number; taken: number[]; onChange: (i: number) => void; disabled?: boolean;
}) {
  return (
    <div className="field">
      <span id="char-label">Your character: <b className="char-name">{characterName(value)}</b></span>
      <div className="char-grid" role="radiogroup" aria-labelledby="char-label">
        {CHARACTERS.map((c, i) => {
          const isTaken = taken.includes(i);
          const on = i === value;
          return (
            <button key={c.name} type="button" role="radio" aria-checked={on}
              disabled={disabled || isTaken}
              aria-label={`${c.name}${isTaken ? ' (already taken in this room)' : ''}`}
              className={`char-opt${on ? ' on' : ''}${isTaken ? ' taken' : ''}`}
              onClick={() => onChange(i)}>
              <Avatar character={i} size={56} dim={isTaken} label={c.name} />
              {isTaken && <span className="char-lock" aria-hidden="true"><Lock size={12} /></span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
