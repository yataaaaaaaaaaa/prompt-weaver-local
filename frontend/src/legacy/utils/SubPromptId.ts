import { toIdString } from './toIdString';

export class SubPromptId {
    private readonly value_: string;

    public constructor(value: string) {
        this.value_ = toIdString(value);
    }

    public static from(value: string): SubPromptId {
        return new SubPromptId(value);
    }

    public toString(): string {
        return this.value_;
    }

    public value(): string {
        return this.value_;
    }

    public equals(other: SubPromptId): boolean {
        return this.value_ === other.value_;
    }

    public compare(other: SubPromptId): number {
        return this.value_.localeCompare(other.value_);
    }
}