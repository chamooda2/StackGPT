package dev.stackgpt.api.extract;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

class RuleExtractorTest {
	final RuleExtractor ex = new RuleExtractor();

	@Test
	void pythonTraceback() {
		var x = ex.extract("""
				Traceback (most recent call last):
				  File "app.py", line 1, in <module>
				    import requests
				ModuleNotFoundError: No module named 'requests'""");
		assertThat(x.errorSigs()).containsExactly("modulenotfounderror: no module named 'requests'", "modulenotfounderror");
		assertThat(x.env()).isEqualTo(Map.of("lang", "python"));
	}

	@Test
	void nodeErrnoWithoutGenericErrorType() {
		var x = ex.extract("Error: listen EADDRINUSE: address already in use :::3000");
		assertThat(x.errorSigs()).containsExactly("eaddrinuse");
	}

	@Test
	void windowsHexCodeAndBuild() {
		var x = ex.extract("Windows 11 24H2 update KB5034441 fails with 0x80070643");
		assertThat(x.errorSigs()).containsExactly("0x80070643");
		assertThat(x.env()).isEqualTo(Map.of("os", "windows", "osVer", "11 24H2"));
	}

	@Test
	void pipSlugOnUbuntu() {
		var x = ex.extract("On Ubuntu 24.04, pip install fails:\nerror: externally-managed-environment\n× This environment is externally managed");
		assertThat(x.errorSigs()).containsExactly("externally-managed-environment");
		assertThat(x.env()).containsExactly(Map.entry("os", "linux"), Map.entry("osVer", "ubuntu 24.04"), Map.entry("lang", "python"));
	}

	@Test
	void pipSlugInline() {
		var x = ex.extract("pip install fails on Ubuntu 24.04 with error: externally-managed-environment, what now?");
		assertThat(x.errorSigs()).containsExactly("externally-managed-environment");
	}

	@Test
	void messageNormalizationMasksPathsAndNumbers() {
		var x = ex.extract("java.lang.UnsupportedClassVersionError: com/example/App has been compiled by a more recent version "
				+ "of the Java Runtime (class file version 65.0), this version of the Java Runtime only recognizes up to 61.0");
		String s = x.errorSigs().get(0);
		assertThat(s).startsWith("unsupportedclassversionerror: <path> has been compiled by a more recent version").hasSizeLessThanOrEqualTo(100);
		assertThat(s).doesNotContain("65").doesNotContain("com/example");
		assertThat(x.errorSigs().get(1)).isEqualTo("unsupportedclassversionerror");
		assertThat(x.env().get("lang")).isEqualTo("java");
	}

	@Test
	void messageCutAtFirstClause() {
		var x = ex.extract("django.db.utils.OperationalError: no such table: blog_post");
		assertThat(x.errorSigs()).containsExactly("operationalerror: no such table", "operationalerror");
	}

	@Test
	void opensslAndNodeErrCode() {
		var x = ex.extract("Error: error:0308010C:digital envelope routines::unsupported\n  code: 'ERR_OSSL_EVP_UNSUPPORTED'");
		assertThat(x.errorSigs()).containsExactly("err_ossl_evp_unsupported", "error:0308010c");
	}

	@Test
	void gitFatal() {
		var x = ex.extract("git pull origin main\nfatal: refusing to merge unrelated histories");
		assertThat(x.errorSigs()).containsExactly("fatal: refusing to merge unrelated histories");
	}

	@Test
	void deviceErrorCodes() {
		assertThat(ex.extract("Windows has stopped this device because it has reported problems. (Code 43)").errorSigs()).containsExactly("code 43");
		assertThat(ex.extract("Canon PIXMA shows Support Code 1688").errorSigs()).containsExactly("support code 1688");
		assertThat(ex.extract("Error Code: 2618-0516").errorSigs()).containsExactly("2618-0516");
		assertThat(ex.extract("Netflix Code: NW-2-5").errorSigs()).containsExactly("nw-2-5");
	}

	@Test
	void deviceAndOsVersion() {
		var x = ex.extract("My Galaxy S23 on Android 14 gets notifications late");
		assertThat(x.env()).isEqualTo(Map.of("os", "android", "osVer", "14", "device", "Galaxy S23"));
	}

	@Test
	void packageVersions() {
		var x = ex.extract("Using Node.js 18 with react-scripts 4.0.3, numpy==2.0.0 and Python 3.12");
		assertThat(x.env().get("pkg")).isEqualTo(Map.of("node", "18", "react-scripts", "4.0.3", "numpy", "2.0.0", "python", "3.12"));
	}

	@Test
	void tiedOsIsOmitted() {
		assertThat(ex.extract("It works on macOS but not on Windows").env()).doesNotContainKey("os");
	}

	@Test
	void statementCollapsedAndCapped() {
		assertThat(ex.extract("  a \n\n b\t c ").statement()).isEqualTo("a b c");
		assertThat(ex.extract("x".repeat(5000)).statement()).hasSize(RuleExtractor.MAX_STATEMENT);
		assertThat(ex.extract(null)).isEqualTo(new Extraction("", List.of(), Map.of()));
	}
}
