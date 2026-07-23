type Props = {
  warranty: string;
  setWarranty: (v: string) => void;
  contractTerms: string;
  setContractTerms: (v: string) => void;
};

const MAX = 5000;

export function ZnAdditionalTab({ warranty, setWarranty, contractTerms, setContractTerms }: Props) {
  return (
    <div className="zn-additional">
      <label className="zn-field zn-field--wide">
        <span className="zn-charcount">
          Гарантийные обязательства
          <em>
            {warranty.length}/{MAX}
          </em>
        </span>
        <textarea
          rows={6}
          maxLength={MAX}
          value={warranty}
          onChange={(e) => setWarranty(e.target.value)}
          placeholder="Например: Гарантия 12 месяцев на шлицевое соединение"
        />
      </label>
      <label className="zn-field zn-field--wide">
        <span className="zn-charcount">
          Дополнительные условия договора
          <em>
            {contractTerms.length}/{MAX}
          </em>
        </span>
        <textarea
          rows={6}
          maxLength={MAX}
          value={contractTerms}
          onChange={(e) => setContractTerms(e.target.value)}
          placeholder="Особые условия, сроки, договорённости с клиентом"
        />
      </label>
    </div>
  );
}
