package com.unical.backend.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.tags.Tag;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI openAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("UniCal Backend API")
                        .description("""
                                AI-powered university schedule extraction backend.

                                **Two main capabilities:**
                                - **Browser sessions** — launches a real Chromium browser via Playwright, \
                                uses GPT vision to navigate to the login page, then hands off to the user \
                                (via a VNC viewer), after which the AI finds the schedule page and extracts \
                                the data automatically.
                                - **HTML extraction** — stateless endpoint that accepts raw HTML of a \
                                university schedule page and returns structured schedule entries using an LLM.
                                """)
                        .version("1.0.0")
                        .contact(new Contact()
                                .name("UniCal")
                                .url("https://github.com/unical")))
                .addTagsItem(new Tag()
                        .name("Sessions")
                        .description("Browser automation sessions: AI-guided login navigation + schedule extraction"))
                .addTagsItem(new Tag()
                        .name("Extraction")
                        .description("Stateless LLM-based schedule extraction from raw HTML"));
    }
}
